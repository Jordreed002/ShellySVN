import { useState, useCallback, useRef, useEffect, useMemo } from 'react'

/**
 * Performance metric types for large repo operations
 */
export interface PerformanceMetric {
  /** Unique identifier for the metric */
  id: string
  /** Name of the operation being measured */
  name: string
  /** Category of the metric */
  category: 'scan' | 'render' | 'memory' | 'network' | 'ui'
  /** Start timestamp in milliseconds */
  startTime: number
  /** End timestamp in milliseconds (0 if still running) */
  endTime: number
  /** Duration in milliseconds */
  duration: number
  /** Whether the operation is still in progress */
  isRunning: boolean
  /** Additional metadata */
  metadata?: Record<string, unknown>
}

/**
 * Memory usage snapshot
 */
export interface MemorySnapshot {
  /** Timestamp of the snapshot */
  timestamp: number
  /** Used JS heap size in bytes */
  usedJSHeapSize: number
  /** Total JS heap size in bytes */
  totalJSHeapSize: number
  /** JS heap size limit in bytes */
  jsHeapSizeLimit: number
  /** DOM nodes count */
  domNodes?: number
  /** Event listeners count */
  eventListeners?: number
}

/**
 * Frame rate snapshot for UI responsiveness
 */
export interface FrameRateSnapshot {
  /** Timestamp of the snapshot */
  timestamp: number
  /** Frames per second */
  fps: number
  /** Frame time in milliseconds */
  frameTime: number
  /** Whether frame was dropped */
  droppedFrame: boolean
}

/**
 * Performance alert configuration
 */
export interface PerformanceAlert {
  /** Alert type */
  type: 'warning' | 'critical'
  /** Metric that triggered the alert */
  metric: string
  /** Current value */
  value: number
  /** Threshold that was exceeded */
  threshold: number
  /** Human-readable message */
  message: string
  /** Timestamp */
  timestamp: number
}

/**
 * Performance thresholds for alerts
 */
export interface PerformanceThresholds {
  /** Maximum acceptable scan time for 100k files (ms) */
  maxScanTime: number
  /** Maximum acceptable memory usage in MB */
  maxMemoryMB: number
  /** Minimum acceptable FPS */
  minFps: number
  /** Maximum acceptable render time (ms) */
  maxRenderTime: number
  /** Maximum acceptable network latency (ms) */
  maxNetworkLatency: number
}

/**
 * Default performance thresholds based on requirements
 */
export const DEFAULT_THRESHOLDS: PerformanceThresholds = {
  maxScanTime: 3000,        // 3 seconds for 100k files
  maxMemoryMB: 500,         // 500MB max memory
  minFps: 55,               // Allow slight dip below 60fps
  maxRenderTime: 16.67,     // One frame at 60fps
  maxNetworkLatency: 1000   // 1 second network timeout
}

/**
 * Options for usePerformanceMonitor hook
 */
export interface PerformanceMonitorOptions {
  /** Whether to enable monitoring */
  enabled?: boolean
  /** Custom thresholds */
  thresholds?: Partial<PerformanceThresholds>
  /** Sample interval for FPS monitoring (ms) */
  fpsSampleInterval?: number
  /** Memory sample interval (ms) */
  memorySampleInterval?: number
  /** Maximum number of metrics to keep in history */
  maxMetricsHistory?: number
  /** Callback when an alert is triggered */
  onAlert?: (alert: PerformanceAlert) => void
}

/**
 * Performance monitor state
 */
export interface PerformanceMonitorState {
  /** All recorded metrics */
  metrics: PerformanceMetric[]
  /** Current memory usage */
  memory: MemorySnapshot | null
  /** Memory usage history */
  memoryHistory: MemorySnapshot[]
  /** Current frame rate */
  fps: number
  /** Frame rate history */
  fpsHistory: FrameRateSnapshot[]
  /** Active alerts */
  alerts: PerformanceAlert[]
  /** Whether any operation is currently running */
  isOperationRunning: boolean
  /** Summary statistics */
  summary: PerformanceSummary
}

/**
 * Summary statistics for performance metrics
 */
export interface PerformanceSummary {
  /** Average scan time in ms */
  avgScanTime: number
  /** Average render time in ms */
  avgRenderTime: number
  /** Peak memory usage in MB */
  peakMemoryMB: number
  /** Average FPS */
  avgFps: number
  /** Total operations count */
  totalOperations: number
  /** Failed operations count */
  failedOperations: number
}

/**
 * Hook for monitoring performance in large repositories.
 *
 * Provides real-time metrics for:
 * - SVN status scan times
 * - Memory usage tracking
 * - Frame rate monitoring for 60fps scrolling
 * - Alert generation when thresholds are exceeded
 *
 * @example
 * ```tsx
 * const { startMetric, endMetric, memory, fps, alerts } = usePerformanceMonitor({
 *   thresholds: { maxScanTime: 3000, maxMemoryMB: 500 }
 * })
 *
 * // Start timing an operation
 * const metricId = startMetric('status-scan', 'scan')
 *
 * // ... perform operation ...
 *
 * // End timing
 * endMetric(metricId, { fileCount: 100000 })
 * ```
 */
export function usePerformanceMonitor(options: PerformanceMonitorOptions = {}) {
  const {
    enabled = true,
    thresholds = {},
    fpsSampleInterval = 1000,
    memorySampleInterval = 2000,
    maxMetricsHistory = 100,
    onAlert
  } = options

  const mergedThresholds = useMemo(() => ({
    ...DEFAULT_THRESHOLDS,
    ...thresholds
  }), [thresholds])

  // State
  const [metrics, setMetrics] = useState<PerformanceMetric[]>([])
  const [memory, setMemory] = useState<MemorySnapshot | null>(null)
  const [memoryHistory, setMemoryHistory] = useState<MemorySnapshot[]>([])
  const [fps, setFps] = useState(60)
  const [fpsHistory, setFpsHistory] = useState<FrameRateSnapshot[]>([])
  const [alerts, setAlerts] = useState<PerformanceAlert[]>([])

  // Refs for FPS calculation
  const frameCountRef = useRef(0)
  const lastFpsTimeRef = useRef(performance.now())
  const rafIdRef = useRef<number | null>(null)

  // Refs for memory monitoring
  const memoryIntervalRef = useRef<NodeJS.Timeout | null>(null)

  // Counter for unique metric IDs
  const metricIdCounterRef = useRef(0)

  /**
   * Create an alert and notify callback
   */
  const createAlert = useCallback((
    type: 'warning' | 'critical',
    metricName: string,
    value: number,
    threshold: number,
    message: string
  ) => {
    const alert: PerformanceAlert = {
      type,
      metric: metricName,
      value,
      threshold,
      message,
      timestamp: Date.now()
    }

    setAlerts(prev => [...prev.slice(-19), alert]) // Keep last 20 alerts
    onAlert?.(alert)

    return alert
  }, [onAlert])

  /**
   * Start timing a metric
   */
  const startMetric = useCallback((
    name: string,
    category: PerformanceMetric['category'],
    metadata?: Record<string, unknown>
  ): string => {
    if (!enabled) return ''

    const id = `metric-${++metricIdCounterRef.current}`
    const metric: PerformanceMetric = {
      id,
      name,
      category,
      startTime: performance.now(),
      endTime: 0,
      duration: 0,
      isRunning: true,
      metadata
    }

    setMetrics(prev => [...prev.slice(-(maxMetricsHistory - 1)), metric])

    return id
  }, [enabled, maxMetricsHistory])

  /**
   * End timing a metric
   */
  const endMetric = useCallback((
    id: string,
    metadata?: Record<string, unknown>
  ): PerformanceMetric | null => {
    if (!enabled || !id) return null

    const endTime = performance.now()
    let resultMetric: PerformanceMetric | null = null

    setMetrics(prev => {
      const metricIndex = prev.findIndex(m => m.id === id)
      if (metricIndex === -1) return prev

      const metric = prev[metricIndex]
      const duration = endTime - metric.startTime

      const updatedMetric: PerformanceMetric = {
        ...metric,
        endTime,
        duration,
        isRunning: false,
        metadata: { ...metric.metadata, ...metadata }
      }

      // Store for return value
      resultMetric = updatedMetric

      // Check thresholds and create alerts
      if (metric.category === 'scan' && duration > mergedThresholds.maxScanTime) {
        const fileCount = metadata?.fileCount as number | undefined
        const message = fileCount
          ? `Status scan took ${(duration).toFixed(0)}ms for ${fileCount.toLocaleString()} files (threshold: ${mergedThresholds.maxScanTime}ms)`
          : `Status scan took ${(duration).toFixed(0)}ms (threshold: ${mergedThresholds.maxScanTime}ms)`

        createAlert(
          duration > mergedThresholds.maxScanTime * 1.5 ? 'critical' : 'warning',
          metric.name,
          duration,
          mergedThresholds.maxScanTime,
          message
        )
      }

      if (metric.category === 'render' && duration > mergedThresholds.maxRenderTime) {
        createAlert(
          'warning',
          metric.name,
          duration,
          mergedThresholds.maxRenderTime,
          `Render took ${duration.toFixed(2)}ms (threshold: ${mergedThresholds.maxRenderTime}ms)`
        )
      }

      const newMetrics = [...prev]
      newMetrics[metricIndex] = updatedMetric
      return newMetrics
    })

    return resultMetric
  }, [enabled, mergedThresholds, createAlert])

  /**
   * Measure a synchronous function's execution time
   */
  const measureSync = useCallback(<T,>(
    name: string,
    category: PerformanceMetric['category'],
    fn: () => T,
    metadata?: Record<string, unknown>
  ): T => {
    if (!enabled) return fn()

    const id = startMetric(name, category, metadata)
    try {
      const result = fn()
      endMetric(id, metadata)
      return result
    } catch (error) {
      endMetric(id, { ...metadata, error: true })
      throw error
    }
  }, [enabled, startMetric, endMetric])

  /**
   * Measure an async function's execution time
   */
  const measureAsync = useCallback(async <T,>(
    name: string,
    category: PerformanceMetric['category'],
    fn: () => Promise<T>,
    metadata?: Record<string, unknown>
  ): Promise<T> => {
    if (!enabled) return fn()

    const id = startMetric(name, category, metadata)
    try {
      const result = await fn()
      endMetric(id, metadata)
      return result
    } catch (error) {
      endMetric(id, { ...metadata, error: true })
      throw error
    }
  }, [enabled, startMetric, endMetric])

  /**
   * Get current memory usage
   * @param detailed - If true, includes expensive DOM metrics (domNodes, eventListeners)
   */
  const getMemorySnapshot = useCallback((detailed = false): MemorySnapshot | null => {
    // @ts-expect-error - memory API not in standard types
    const memoryInfo = performance.memory
    if (!memoryInfo) return null

    return {
      timestamp: Date.now(),
      usedJSHeapSize: memoryInfo.usedJSHeapSize,
      totalJSHeapSize: memoryInfo.totalJSHeapSize,
      jsHeapSizeLimit: memoryInfo.jsHeapSizeLimit,
      // Only compute expensive DOM metrics when detailed mode is enabled
      ...(detailed && {
        domNodes: document.querySelectorAll('*').length,
        eventListeners: getEventListenerCount()
      })
    }
  }, [])

  /**
   * Check memory thresholds and create alerts
   */
  const checkMemoryThreshold = useCallback((snapshot: MemorySnapshot) => {
    const usedMB = snapshot.usedJSHeapSize / (1024 * 1024)

    if (usedMB > mergedThresholds.maxMemoryMB) {
      createAlert(
        usedMB > mergedThresholds.maxMemoryMB * 1.2 ? 'critical' : 'warning',
        'memory-usage',
        usedMB,
        mergedThresholds.maxMemoryMB,
        `Memory usage at ${usedMB.toFixed(0)}MB (threshold: ${mergedThresholds.maxMemoryMB}MB)`
      )
    }
  }, [mergedThresholds, createAlert])

  /**
   * FPS monitoring using requestAnimationFrame
   */
  const measureFps = useCallback(() => {
    if (!enabled) return

    const measureFrame = () => {
      frameCountRef.current++

      const now = performance.now()
      const elapsed = now - lastFpsTimeRef.current

      if (elapsed >= fpsSampleInterval) {
        const currentFps = Math.round((frameCountRef.current * 1000) / elapsed)
        const frameTime = elapsed / frameCountRef.current
        const droppedFrame = frameTime > 20 // Consider dropped if > 20ms

        setFps(currentFps)
        setFpsHistory(prev => {
          const newHistory = [...prev, {
            timestamp: now,
            fps: currentFps,
            frameTime,
            droppedFrame
          }].slice(-60) // Keep last 60 samples (1 minute at 1s intervals)

          return newHistory
        })

        // Check FPS threshold
        if (currentFps < mergedThresholds.minFps) {
          createAlert(
            'warning',
            'frame-rate',
            currentFps,
            mergedThresholds.minFps,
            `Frame rate dropped to ${currentFps}fps (threshold: ${mergedThresholds.minFps}fps)`
          )
        }

        frameCountRef.current = 0
        lastFpsTimeRef.current = now
      }

      rafIdRef.current = requestAnimationFrame(measureFrame)
    }

    rafIdRef.current = requestAnimationFrame(measureFrame)
  }, [enabled, fpsSampleInterval, mergedThresholds, createAlert])

  /**
   * Memory monitoring interval
   */
  const startMemoryMonitoring = useCallback(() => {
    if (!enabled) return

    // Initial snapshot
    const initialSnapshot = getMemorySnapshot()
    if (initialSnapshot) {
      setMemory(initialSnapshot)
      setMemoryHistory([initialSnapshot])
    }

    // Start interval
    memoryIntervalRef.current = setInterval(() => {
      const snapshot = getMemorySnapshot()
      if (snapshot) {
        setMemory(snapshot)
        setMemoryHistory(prev => [...prev.slice(-29), snapshot]) // Keep last 30 samples
        checkMemoryThreshold(snapshot)
      }
    }, memorySampleInterval)
  }, [enabled, memorySampleInterval, getMemorySnapshot, checkMemoryThreshold])

  /**
   * Clear all metrics history
   */
  const clearMetrics = useCallback(() => {
    setMetrics([])
    setAlerts([])
  }, [])

  /**
   * Clear FPS history
   */
  const clearFpsHistory = useCallback(() => {
    setFpsHistory([])
    setFps(60)
  }, [])

  /**
   * Clear memory history
   */
  const clearMemoryHistory = useCallback(() => {
    setMemoryHistory([])
  }, [])

  /**
   * Get metrics by category
   */
  const getMetricsByCategory = useCallback((category: PerformanceMetric['category']) => {
    return metrics.filter(m => m.category === category)
  }, [metrics])

  /**
   * Get metrics by name
   */
  const getMetricsByName = useCallback((name: string) => {
    return metrics.filter(m => m.name === name)
  }, [metrics])

  // Calculate summary statistics
  const summary = useMemo<PerformanceSummary>(() => {
    const scanMetrics = metrics.filter(m => m.category === 'scan' && !m.isRunning)
    const renderMetrics = metrics.filter(m => m.category === 'render' && !m.isRunning)
    const failedMetrics = metrics.filter(m => m.metadata?.error)

    return {
      avgScanTime: scanMetrics.length > 0
        ? scanMetrics.reduce((sum, m) => sum + m.duration, 0) / scanMetrics.length
        : 0,
      avgRenderTime: renderMetrics.length > 0
        ? renderMetrics.reduce((sum, m) => sum + m.duration, 0) / renderMetrics.length
        : 0,
      peakMemoryMB: memoryHistory.length > 0
        ? Math.max(...memoryHistory.map(m => m.usedJSHeapSize)) / (1024 * 1024)
        : 0,
      avgFps: fpsHistory.length > 0
        ? fpsHistory.reduce((sum, f) => sum + f.fps, 0) / fpsHistory.length
        : 60,
      totalOperations: metrics.length,
      failedOperations: failedMetrics.length
    }
  }, [metrics, memoryHistory, fpsHistory])

  // Check if any operation is running
  const isOperationRunning = useMemo(() => {
    return metrics.some(m => m.isRunning)
  }, [metrics])

  // Start/stop monitoring based on enabled flag
  useEffect(() => {
    if (enabled) {
      measureFps()
      startMemoryMonitoring()
    }

    return () => {
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current)
      }
      if (memoryIntervalRef.current !== null) {
        clearInterval(memoryIntervalRef.current)
      }
    }
  }, [enabled, measureFps, startMemoryMonitoring])

  return {
    // Core metrics functions
    startMetric,
    endMetric,
    measureSync,
    measureAsync,

    // State
    metrics,
    memory,
    memoryHistory,
    fps,
    fpsHistory,
    alerts,
    isOperationRunning,
    summary,

    // Utility functions
    clearMetrics,
    clearFpsHistory,
    clearMemoryHistory,
    getMetricsByCategory,
    getMetricsByName,
    getMemorySnapshot,

    // Configuration
    thresholds: mergedThresholds
  }
}

/**
 * Helper to estimate event listener count
 */
function getEventListenerCount(): number {
  // This is an approximation - true count requires devtools protocol
  const elements = document.querySelectorAll('*')
  let count = 0

  // Check for common event properties (this is heuristic-based)
  elements.forEach(el => {
    const eventTypes = ['onclick', 'onchange', 'onsubmit', 'onkeydown', 'onkeyup', 'onmouseover', 'onmouseout']
    eventTypes.forEach(type => {
      if ((el as Element & Record<string, unknown>)[type]) {
        count++
      }
    })
  })

  return count
}

/**
 * Format bytes to human readable string
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'

  const units = ['B', 'KB', 'MB', 'GB']
  const k = 1024
  const i = Math.floor(Math.log(bytes) / Math.log(k))

  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${units[i]}`
}

/**
 * Format milliseconds to human readable string
 */
export function formatDuration(ms: number): string {
  if (ms < 1) return `${(ms * 1000).toFixed(0)}μs`
  if (ms < 1000) return `${ms.toFixed(ms < 10 ? 1 : 0)}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(2)}s`

  const minutes = Math.floor(ms / 60000)
  const seconds = Math.floor((ms % 60000) / 1000)
  return `${minutes}m ${seconds}s`
}

export default usePerformanceMonitor
