import { create } from 'zustand'

/**
 * Generate a unique ID
 */
function generateId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

export type OperationType = 
  | 'commit' 
  | 'update' 
  | 'revert' 
  | 'add' 
  | 'delete' 
  | 'checkout' 
  | 'export' 
  | 'import'
  | 'merge'
  | 'switch'
  | 'copy'
  | 'move'
  | 'cleanup'
  | 'lock'
  | 'unlock'
  | 'resolve'
  | 'patch'
  | 'custom'

export type OperationStatus = 
  | 'pending' 
  | 'running' 
  | 'completed' 
  | 'failed' 
  | 'cancelled'

export interface Operation {
  id: string
  type: OperationType
  title: string
  description?: string
  status: OperationStatus
  progress?: number // 0-100
  currentFile?: string
  filesProcessed?: number
  totalFiles?: number
  startedAt?: number
  completedAt?: number
  error?: string
  output?: string
  cancellable: boolean
  retryable: boolean
  retryCount: number
  maxRetries: number
  path?: string
  metadata?: Record<string, unknown>
}

interface OperationQueueState {
  operations: Operation[]
  maxConcurrent: number
  isPaused: boolean
  
  // Actions
  addOperation: (op: Omit<Operation, 'id' | 'status' | 'retryCount' | 'startedAt' | 'completedAt'>) => string
  updateOperation: (id: string, updates: Partial<Operation>) => void
  removeOperation: (id: string) => void
  cancelOperation: (id: string) => void
  retryOperation: (id: string) => void
  clearCompleted: () => void
  pauseQueue: () => void
  resumeQueue: () => void
  
  // Getters
  getOperation: (id: string) => Operation | undefined
  getRunningOperations: () => Operation[]
  getPendingOperations: () => Operation[]
  getOperationByPath: (path: string, type?: OperationType) => Operation | undefined
}

export const useOperationQueue = create<OperationQueueState>((set, get) => ({
  operations: [],
  maxConcurrent: 3,
  isPaused: false,
  
  addOperation: (op) => {
    const id = generateId()
    const newOp: Operation = {
      ...op,
      id,
      status: 'pending',
      retryCount: 0,
      cancellable: op.cancellable ?? true,
      retryable: op.retryable ?? true,
      maxRetries: op.maxRetries ?? 3
    }
    
    set((state) => ({
      operations: [...state.operations, newOp]
    }))
    
    return id
  },
  
  updateOperation: (id, updates) => {
    set((state) => ({
      operations: state.operations.map((op) =>
        op.id === id ? { ...op, ...updates } : op
      )
    }))
  },
  
  removeOperation: (id) => {
    set((state) => ({
      operations: state.operations.filter((op) => op.id !== id)
    }))
  },
  
  cancelOperation: (id) => {
    const op = get().getOperation(id)
    if (!op || !op.cancellable) return
    
    set((state) => ({
      operations: state.operations.map((o) =>
        o.id === id 
          ? { ...o, status: 'cancelled' as const, completedAt: Date.now() }
          : o
      )
    }))
  },
  
  retryOperation: (id) => {
    const op = get().getOperation(id)
    if (!op || !op.retryable || op.retryCount >= op.maxRetries) return
    
    set((state) => ({
      operations: state.operations.map((o) =>
        o.id === id
          ? { 
              ...o, 
              status: 'pending' as const, 
              error: undefined,
              retryCount: o.retryCount + 1,
              startedAt: undefined,
              completedAt: undefined
            }
          : o
      )
    }))
  },
  
  clearCompleted: () => {
    set((state) => ({
      operations: state.operations.filter(
        (op) => !['completed', 'failed', 'cancelled'].includes(op.status)
      )
    }))
  },
  
  pauseQueue: () => {
    set({ isPaused: true })
  },
  
  resumeQueue: () => {
    set({ isPaused: false })
  },
  
  getOperation: (id) => {
    return get().operations.find((op) => op.id === id)
  },
  
  getRunningOperations: () => {
    return get().operations.filter((op) => op.status === 'running')
  },
  
  getPendingOperations: () => {
    return get().operations.filter((op) => op.status === 'pending')
  },
  
  getOperationByPath: (path, type) => {
    return get().operations.find(
      (op) => op.path === path && (!type || op.type === type)
    )
  }
}))

/**
 * Hook to execute an operation with queue management
 */
export function useOperationExecutor() {
  const { addOperation, updateOperation, isPaused, getRunningOperations, maxConcurrent } = useOperationQueue()
  
  const executeOperation = async <T>(
    type: OperationType,
    title: string,
    executor: (signal: AbortSignal, onProgress?: (progress: number, currentFile?: string) => void) => Promise<T>,
    options: {
      description?: string
      path?: string
      cancellable?: boolean
      retryable?: boolean
      maxRetries?: number
      metadata?: Record<string, unknown>
    } = {}
  ): Promise<{ operationId: string; result?: T; error?: Error }> => {
    const operationId = addOperation({
      type,
      title,
      description: options.description,
      path: options.path,
      cancellable: options.cancellable ?? true,
      retryable: options.retryable ?? true,
      maxRetries: options.maxRetries ?? 3,
      metadata: options.metadata
    })
    
    // Wait for queue slot
    while (isPaused || getRunningOperations().length >= maxConcurrent) {
      await new Promise((resolve) => setTimeout(resolve, 100))
      
      // Check if cancelled while waiting
      const op = useOperationQueue.getState().getOperation(operationId)
      if (op?.status === 'cancelled') {
        return { operationId, error: new Error('Operation cancelled') }
      }
    }
    
    // Start operation
    updateOperation(operationId, {
      status: 'running',
      startedAt: Date.now()
    })
    
    const controller = new AbortController()
    
    // Set up cancellation listener
    const unsubscribe = useOperationQueue.subscribe((state, prevState) => {
      const prevOp = prevState.operations.find((o) => o.id === operationId)
      const currentOp = state.operations.find((o) => o.id === operationId)
      
      if (prevOp?.status !== 'cancelled' && currentOp?.status === 'cancelled') {
        controller.abort()
      }
    })
    
    // Progress callback
    const onProgress = (progress: number, currentFile?: string) => {
      updateOperation(operationId, { progress, currentFile })
    }
    
    try {
      const result = await executor(controller.signal, onProgress)
      
      updateOperation(operationId, {
        status: 'completed',
        progress: 100,
        completedAt: Date.now()
      })
      
      return { operationId, result }
    } catch (err) {
      const error = err as Error
      
      if (error.name === 'AbortError') {
        updateOperation(operationId, {
          status: 'cancelled',
          completedAt: Date.now()
        })
        return { operationId, error: new Error('Operation cancelled') }
      }
      
      updateOperation(operationId, {
        status: 'failed',
        error: error.message,
        completedAt: Date.now()
      })
      
      return { operationId, error }
    } finally {
      unsubscribe()
    }
  }
  
  return { executeOperation }
}

export default useOperationQueue
