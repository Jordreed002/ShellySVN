import type {
  SvnBlameResult,
  SvnDiffResult,
  SvnExecutionContext,
  SvnLogResult,
  SvnStatusChar,
  SvnStatusResult,
} from '@shared/types';

export interface FsSvnStatusEntry {
  status: SvnStatusChar;
  revision?: number;
  author?: string;
  fullPath: string;
}

export interface FsSvnStatusResult {
  directStatus: {
    [filename: string]: { status: SvnStatusChar; revision?: number; author?: string };
  };
  allEntries: FsSvnStatusEntry[];
}

export type WorkerJobName =
  | 'svn:deepStatus'
  | 'svn:fsStatus'
  | 'svn:workingCopyStatus'
  | 'svn:diff'
  | 'svn:diffStreaming'
  | 'svn:diffUrls'
  | 'svn:log'
  | 'svn:blame';

export interface StatusPayload {
  dirPath: string;
  svnCommand: string;
  context: SvnExecutionContext;
  depth?: 'empty' | 'files' | 'immediates' | 'infinity';
  showUpdates?: boolean;
  trustSslFailures?: boolean;
}

export type DeepStatusPayload = StatusPayload;

export interface DiffPayload {
  path: string;
  revision?: string;
  svnCommand: string;
  context: SvnExecutionContext;
}

export interface DiffUrlsPayload {
  leftUrl: string;
  rightUrl: string;
  svnCommand: string;
  context: SvnExecutionContext;
}

export interface LogPayload {
  path: string;
  limit: number;
  startRev?: number;
  endRev?: number;
  useMergeHistory?: boolean;
  svnCommand: string;
  context: SvnExecutionContext;
}

export interface BlamePayload {
  path: string;
  startRevision?: number;
  endRevision?: number;
  svnCommand: string;
  context: SvnExecutionContext;
}

export type WorkerJobPayloadMap = {
  'svn:deepStatus': DeepStatusPayload;
  'svn:fsStatus': StatusPayload;
  'svn:workingCopyStatus': StatusPayload;
  'svn:diff': DiffPayload;
  'svn:diffStreaming': DiffPayload;
  'svn:diffUrls': DiffUrlsPayload;
  'svn:log': LogPayload;
  'svn:blame': BlamePayload;
};

export type WorkerJobResultMap = {
  'svn:deepStatus': FsSvnStatusResult;
  'svn:fsStatus': FsSvnStatusResult;
  'svn:workingCopyStatus': SvnStatusResult;
  'svn:diff': SvnDiffResult;
  'svn:diffStreaming': SvnDiffResult;
  'svn:diffUrls': SvnDiffResult;
  'svn:log': SvnLogResult;
  'svn:blame': SvnBlameResult;
};

export type WorkerPriority = 'interactive' | 'background';

export type WorkerProgressChannel =
  | 'svn:operation:progress'
  | 'svn:update:progress'
  | 'svn:checkout:progress';

export interface WorkerProgressEvent {
  channel: WorkerProgressChannel;
  payload: unknown;
}

export interface WorkerJobMessage<N extends WorkerJobName = WorkerJobName> {
  id: string;
  name: N;
  payload: WorkerJobPayloadMap[N];
}

export type WorkerParentMessage =
  | WorkerJobMessage
  | {
      type: 'cancel';
      id: string;
    };

export type WorkerChildMessage =
  | {
      type: 'result';
      id: string;
      result: WorkerJobResultMap[WorkerJobName];
    }
  | {
      type: 'progress';
      id: string;
      progress: WorkerProgressEvent;
    }
  | {
      type: 'error';
      id: string;
      error: string;
    };

export interface WorkerRunOptions {
  id?: string;
  priority?: WorkerPriority;
  timeoutMs?: number;
  onProgress?: (progress: WorkerProgressEvent) => void;
}
