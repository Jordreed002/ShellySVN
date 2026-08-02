type BatchUpdateStatus =
  | 'idle'
  | 'checking'
  | 'ready'
  | 'queued'
  | 'running'
  | 'completed'
  | 'cancelled'
  | 'failed'
  | 'blocked';

type BatchBlockedKind =
  | 'missing'
  | 'unmeasured'
  | 'unreachable'
  | 'authentication'
  | 'conflicted'
  | 'cleanup-required'
  | 'stale-lock'
  | 'active-mutation'
  | 'at-head';

export interface BatchUpdateItem {
  path: string;
  name: string;
  repositoryUrl?: string;
  repositoryRoot?: string;
  baseRevision?: number;
  headRevision?: number;
  incomingCount?: number;
  localChangeCount?: number;
  conflictCount?: number;
  selected: boolean;
  requiresDirtyConfirmation: boolean;
  blockedKind?: BatchBlockedKind;
  blockedReason?: string;
  status: BatchUpdateStatus;
  operationId?: string;
  cancellationRequested?: boolean;
  filesProcessed: number;
  revision?: number | null;
  error?: string;
  verificationError?: string;
  checkedAt?: number;
  measurementSource?: 'fresh' | 'cached';
  incomingCapped?: boolean;
}

export interface BatchUpdateSummary {
  total: number;
  selected: number;
  queued: number;
  running: number;
  completed: number;
  cancelled: number;
  failed: number;
  blocked: number;
}

export interface BatchUpdateController {
  items: readonly BatchUpdateItem[];
  summary: BatchUpdateSummary;
  isChecking: boolean;
  checkAll: () => Promise<void>;
  toggleSelection: (path: string) => Promise<void>;
  startSelected: () => Promise<void>;
  cancelItem: (path: string) => Promise<void>;
  cancelAll: () => Promise<void>;
  retryFailed: () => Promise<void>;
  clearCompleted: () => void;
}
