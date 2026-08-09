import { useQuery } from '@tanstack/react-query';
import {
  RefreshCw,
  X,
  Check,
  AlertCircle,
  AlertTriangle,
  Wifi,
  WifiOff,
  Key,
  Folder,
  Server,
  Loader,
  Copy,
  MonitorCog,
  Shield,
  Activity,
  GitBranch,
  Trash2,
} from 'lucide-react';
import { useState, useEffect, useCallback } from 'react';
import type { RepoDiagnostics } from '@shared/types';
import { redactDiagnosticText } from './ErrorBoundary/redaction';
import { useFocusTrap } from '@renderer/hooks/useFocusTrap';

interface RepoDiagnosticsProps {
  workingCopyPath: string;
  onClose: () => void;
  onAuthenticate?: () => void;
}

function getStatusIcon(status: RepoDiagnostics['connectionStatus']) {
  switch (status) {
    case 'ok':
      return <Check className="w-5 h-5 text-green-500" />;
    case 'auth-required':
      return <Key className="w-5 h-5 text-yellow-500" />;
    case 'ssl-error':
      return <AlertTriangle className="w-5 h-5 text-yellow-500" />;
    case 'network-error':
      return <WifiOff className="w-5 h-5 text-red-500" />;
    default:
      return <AlertCircle className="w-5 h-5 text-gray-400" />;
  }
}

function getStatusText(status: RepoDiagnostics['connectionStatus']) {
  switch (status) {
    case 'ok':
      return { text: 'Connected', className: 'text-green-600 dark:text-green-400' };
    case 'auth-required':
      return {
        text: 'Authentication Required',
        className: 'text-yellow-600 dark:text-yellow-400',
      };
    case 'ssl-error':
      return { text: 'SSL Certificate Error', className: 'text-yellow-600 dark:text-yellow-400' };
    case 'network-error':
      return { text: 'Network Error', className: 'text-red-600 dark:text-red-400' };
    default:
      return { text: 'Unknown', className: 'text-gray-500' };
  }
}

export function buildDiagnosticsReport(
  diagnostics: RepoDiagnostics,
  workingCopyPath: string
): string {
  return redactDiagnosticText(
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        app: {
          svnClientPath: diagnostics.svnClientPath,
          svnVersion: diagnostics.svnVersion,
          minimumSvnVersion: diagnostics.minimumSvnVersion,
          svnVersionSupported: diagnostics.svnVersionSupported,
          svnVersionWarning: diagnostics.svnVersionWarning,
          svnVersionError: diagnostics.svnVersionError,
          encryptionAvailable: diagnostics.encryptionAvailable,
          isPackaged: diagnostics.isPackaged,
          resourcesPath: diagnostics.resourcesPath,
          resourceStatus: diagnostics.resourceStatus,
        },
        workingCopy: {
          requestedPath: workingCopyPath,
          isValidWorkingCopy: diagnostics.isValidWorkingCopy,
          workingCopyRoot: diagnostics.workingCopyRoot,
        },
        repository: {
          repositoryRoot: diagnostics.repositoryRoot,
          repositoryUrl: diagnostics.repositoryUrl,
          repositoryUuid: diagnostics.repositoryUuid,
        },
        authentication: {
          hasCredentials: diagnostics.hasCredentials,
          credentialRealm: diagnostics.credentialRealm,
          credentialUsernamePresent: Boolean(diagnostics.credentialUsername),
        },
        connection: {
          status: diagnostics.connectionStatus,
          error: diagnostics.connectionError,
        },
      },
      null,
      2
    )
  );
}

export function RepoDiagnosticsPanel({
  workingCopyPath,
  onClose,
  onAuthenticate,
}: RepoDiagnosticsProps) {
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'failed'>('idle');
  const [isTrustingCertificate, setIsTrustingCertificate] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const dialogRef = useFocusTrap<HTMLDivElement>({ onEscape: onClose, preventScroll: true });

  const {
    data: diagnostics,
    isLoading,
    error: queryError,
    refetch,
  } = useQuery({
    queryKey: ['diagnostics', workingCopyPath],
    queryFn: () => window.api.svn.diagnostics(workingCopyPath),
    staleTime: 30000, // 30 seconds
  });
  const healthQuery = useQuery({
    queryKey: ['working-copy-health', workingCopyPath],
    queryFn: () => window.api.svn.workingCopyHealth(workingCopyPath),
    enabled: typeof window.api.svn.workingCopyHealth === 'function',
    staleTime: 30_000,
  });
  const timelineQuery = useQuery({
    queryKey: ['svn-command-timeline'],
    queryFn: () => window.api.svn.commandTimeline(),
    enabled: typeof window.api.svn.commandTimeline === 'function',
    staleTime: 5_000,
  });
  const refetchHealth = healthQuery.refetch;
  const refetchTimeline = timelineQuery.refetch;

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    setActionError(null);
    await Promise.all([refetch(), refetchHealth(), refetchTimeline()]);
    setIsRefreshing(false);
  }, [refetch, refetchHealth, refetchTimeline]);

  const handleTrustCertificate = async () => {
    if (!diagnostics?.repositoryUrl || !diagnostics.connectionError) {
      return;
    }

    setIsTrustingCertificate(true);
    setActionError(null);
    try {
      const result = await window.api.svn.trustServerCertificate(
        diagnostics.repositoryUrl,
        diagnostics.connectionError
      );
      if (!result.success) {
        setActionError(result.error || 'Failed to trust certificate');
        return;
      }

      await refetch();
    } catch (trustError) {
      setActionError((trustError as Error).message || 'Failed to trust certificate');
    } finally {
      setIsTrustingCertificate(false);
    }
  };

  const handleCopyDiagnostics = async () => {
    if (!diagnostics) return;

    try {
      await navigator.clipboard.writeText(buildDiagnosticsReport(diagnostics, workingCopyPath));
      setCopyStatus('copied');
      window.setTimeout(() => setCopyStatus('idle'), 2000);
    } catch {
      setCopyStatus('failed');
      window.setTimeout(() => setCopyStatus('idle'), 3000);
    }
  };

  // Handle keyboard shortcuts not already covered by the dialog focus trap.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'r' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        handleRefresh();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleRefresh]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto overscroll-contain bg-black/50 p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        ref={dialogRef}
        className="flex max-h-[calc(100dvh-2rem)] w-full max-w-lg flex-col overflow-hidden rounded-lg bg-white shadow-xl dark:bg-gray-800"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="repository-diagnostics-title"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700">
          <h2
            id="repository-diagnostics-title"
            className="text-lg font-semibold text-gray-900 dark:text-gray-100"
          >
            Repository Diagnostics
          </h2>
          <div className="flex items-center gap-2">
            <button
              onClick={handleCopyDiagnostics}
              disabled={!diagnostics}
              className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50"
              title="Copy redacted diagnostics"
              aria-label="Copy redacted diagnostics"
            >
              {copyStatus === 'copied' ? (
                <Check className="w-4 h-4 text-green-600 dark:text-green-400" />
              ) : (
                <Copy className="w-4 h-4 text-gray-600 dark:text-gray-400" />
              )}
            </button>
            <button
              onClick={handleRefresh}
              disabled={isLoading || isRefreshing}
              className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50"
              title="Refresh (Ctrl+R)"
              aria-label="Refresh repository diagnostics"
              aria-busy={isLoading || isRefreshing}
            >
              <RefreshCw
                className={`w-4 h-4 text-gray-600 dark:text-gray-400 ${isRefreshing ? 'animate-spin motion-reduce:animate-none' : ''}`}
                aria-hidden="true"
              />
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700"
              title="Close (Esc)"
              aria-label="Close repository diagnostics"
            >
              <X className="w-4 h-4 text-gray-600 dark:text-gray-400" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
          {isLoading ? (
            <div className="flex items-center justify-center py-8" role="status" aria-live="polite">
              <Loader
                className="w-6 h-6 animate-spin text-accent motion-reduce:animate-none"
                aria-hidden="true"
              />
              <span className="ml-2 text-gray-600 dark:text-gray-400">Running diagnostics…</span>
            </div>
          ) : queryError ? (
            <div
              className="p-4 bg-red-50 dark:bg-red-900/20 rounded-lg border border-red-200 dark:border-red-800"
              role="alert"
            >
              <p className="text-red-700 dark:text-red-400">Failed to run diagnostics</p>
              <p className="text-sm text-red-600 dark:text-red-500 mt-1">
                {(queryError as Error).message}
              </p>
            </div>
          ) : diagnostics ? (
            <>
              {healthQuery.data && (
                <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-900">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <Activity className="h-5 w-5 text-accent" />
                      <h3 className="font-medium text-gray-900 dark:text-gray-100">
                        Working-copy health
                      </h3>
                    </div>
                    <span className="font-mono text-xs text-gray-500">
                      {healthQuery.data.minimumRevision === healthQuery.data.maximumRevision
                        ? `r${healthQuery.data.minimumRevision ?? '—'}`
                        : `r${healthQuery.data.minimumRevision ?? '—'}–r${healthQuery.data.maximumRevision ?? '—'}`}
                    </span>
                  </div>
                  <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {[
                      ['Changes', healthQuery.data.counts.changes],
                      ['Conflicts', healthQuery.data.counts.conflicts],
                      ['Switched', healthQuery.data.counts.switched],
                      ['Externals', healthQuery.data.counts.externals],
                    ].map(([label, value]) => (
                      <div
                        key={label}
                        className="rounded border border-gray-200 bg-white px-2 py-2 text-center dark:border-gray-700 dark:bg-gray-800"
                      >
                        <div className="font-mono text-base font-semibold text-gray-900 dark:text-gray-100">
                          {value}
                        </div>
                        <div className="text-[10px] uppercase tracking-wide text-gray-500">
                          {label}
                        </div>
                      </div>
                    ))}
                  </div>
                  {healthQuery.data.issues.length === 0 ? (
                    <p className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
                      <Check className="h-4 w-4" />
                      No working-copy hygiene risks detected.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {healthQuery.data.issues.map((issue) => (
                        <div
                          key={issue.id}
                          className="flex items-start gap-2 rounded border border-gray-200 bg-white px-3 py-2 dark:border-gray-700 dark:bg-gray-800"
                        >
                          <span
                            className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${issue.severity === 'danger' ? 'bg-red-500' : issue.severity === 'warning' ? 'bg-yellow-500' : 'bg-blue-500'}`}
                            aria-hidden="true"
                          />
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-baseline gap-2 text-sm font-medium text-gray-800 dark:text-gray-200">
                              <span>{issue.title}</span>
                              <span className="text-[10px] uppercase tracking-wide text-gray-500">
                                {issue.severity}
                              </span>
                            </div>
                            <div className="text-xs text-gray-500">{issue.detail}</div>
                            {issue.paths.length > 0 && (
                              <div
                                className="mt-1 truncate font-mono text-[10px] text-gray-400"
                                title={issue.paths.join('\n')}
                              >
                                {issue.paths.length} affected path
                                {issue.paths.length === 1 ? '' : 's'}
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {timelineQuery.data && timelineQuery.data.length > 0 && (
                <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-900">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <GitBranch className="h-5 w-5 text-gray-500" />
                      <h3 className="font-medium text-gray-900 dark:text-gray-100">
                        Command timeline
                      </h3>
                    </div>
                    <button
                      type="button"
                      className="p-1 text-gray-400 hover:text-red-500"
                      title="Clear command timeline"
                      aria-label="Clear command timeline"
                      onClick={async () => {
                        await window.api.svn.clearCommandTimeline();
                        await timelineQuery.refetch();
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <div className="space-y-1.5 overflow-x-auto">
                    {timelineQuery.data.slice(0, 8).map((entry) => (
                      <div
                        key={entry.id}
                        className="grid min-w-[28rem] grid-cols-[5rem_1fr_auto] items-center gap-2 text-xs"
                      >
                        <span className="font-mono text-gray-700 dark:text-gray-300">
                          {entry.operation}
                        </span>
                        <span className="text-gray-500">
                          {entry.affectedPathCount} target{entry.affectedPathCount === 1 ? '' : 's'}
                          {entry.safeDiagnostic ? ` · ${entry.safeDiagnostic}` : ''}
                        </span>
                        <span
                          className={
                            entry.status === 'failed'
                              ? 'text-red-500'
                              : entry.status === 'cancelled'
                                ? 'text-yellow-500'
                                : entry.status === 'running'
                                  ? 'text-blue-500'
                                  : 'text-green-500'
                          }
                        >
                          {entry.status} · {entry.durationMs}ms
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* App Diagnostics */}
              <div className="p-4 bg-gray-50 dark:bg-gray-900 rounded-lg">
                <div className="flex items-center gap-2 mb-2">
                  <MonitorCog className="w-5 h-5 text-gray-600 dark:text-gray-400" />
                  <h3 className="font-medium text-gray-900 dark:text-gray-100">App Diagnostics</h3>
                </div>
                <div className="space-y-2 text-sm">
                  <div>
                    <span className="text-gray-500 dark:text-gray-500">SVN client:</span>
                    <p className="text-gray-700 dark:text-gray-300 font-mono text-xs break-all">
                      {diagnostics.svnClientPath}
                    </p>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <span className="text-gray-500 dark:text-gray-500">SVN version</span>
                      <p className="text-gray-700 dark:text-gray-300 text-xs">
                        {diagnostics.svnVersion || 'Unavailable'}
                      </p>
                    </div>
                    <div>
                      <span className="text-gray-500 dark:text-gray-500">Advanced baseline</span>
                      <p className="text-gray-700 dark:text-gray-300 text-xs">
                        SVN {diagnostics.minimumSvnVersion}.x+
                      </p>
                    </div>
                    <div>
                      <span className="text-gray-500 dark:text-gray-500">Encryption</span>
                      <p
                        className={
                          diagnostics.encryptionAvailable
                            ? 'text-green-600 dark:text-green-400 text-xs'
                            : 'text-yellow-600 dark:text-yellow-400 text-xs'
                        }
                      >
                        {diagnostics.encryptionAvailable ? 'Available' : 'Unavailable'}
                      </p>
                    </div>
                  </div>
                  {diagnostics.svnVersionError && (
                    <p className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 p-2 rounded">
                      {diagnostics.svnVersionError}
                    </p>
                  )}
                  {diagnostics.svnVersionWarning && (
                    <p className="text-xs text-yellow-700 dark:text-yellow-300 bg-yellow-50 dark:bg-yellow-900/20 p-2 rounded">
                      {diagnostics.svnVersionWarning}
                    </p>
                  )}
                  <div className="space-y-1">
                    {diagnostics.resourceStatus.map((resource) => (
                      <div
                        key={`${resource.source}:${resource.path}`}
                        className="flex items-center justify-between gap-3"
                      >
                        <span className="text-gray-600 dark:text-gray-400">{resource.name}</span>
                        <span
                          className={
                            resource.exists && resource.isFile
                              ? 'text-green-600 dark:text-green-400 text-xs'
                              : 'text-yellow-600 dark:text-yellow-400 text-xs'
                          }
                          title={resource.path}
                        >
                          {resource.exists && resource.isFile ? 'Present' : 'Missing'}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Working Copy Status */}
              <div className="p-4 bg-gray-50 dark:bg-gray-900 rounded-lg">
                <div className="flex items-center gap-2 mb-2">
                  <Folder className="w-5 h-5 text-gray-600 dark:text-gray-400" />
                  <h3 className="font-medium text-gray-900 dark:text-gray-100">Working Copy</h3>
                </div>
                {diagnostics.isValidWorkingCopy ? (
                  <div className="space-y-1 text-sm">
                    <div className="flex items-center gap-2">
                      <Check className="w-4 h-4 text-green-500" />
                      <span className="text-green-600 dark:text-green-400">Valid working copy</span>
                    </div>
                    {diagnostics.workingCopyRoot && (
                      <p
                        className="text-gray-600 dark:text-gray-400 pl-6 font-mono text-xs truncate"
                        title={diagnostics.workingCopyRoot}
                      >
                        {diagnostics.workingCopyRoot}
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 text-red-500" />
                    <span className="text-red-600 dark:text-red-400">Not a valid working copy</span>
                  </div>
                )}
              </div>

              {/* Repository Info */}
              {diagnostics.repositoryRoot && (
                <div className="p-4 bg-gray-50 dark:bg-gray-900 rounded-lg">
                  <div className="flex items-center gap-2 mb-2">
                    <Server className="w-5 h-5 text-gray-600 dark:text-gray-400" />
                    <h3 className="font-medium text-gray-900 dark:text-gray-100">Repository</h3>
                  </div>
                  <div className="space-y-1 text-sm">
                    {diagnostics.repositoryUrl && (
                      <div>
                        <span className="text-gray-500 dark:text-gray-500">URL:</span>
                        <p className="text-gray-700 dark:text-gray-300 font-mono text-xs break-all">
                          {diagnostics.repositoryUrl}
                        </p>
                      </div>
                    )}
                    <div>
                      <span className="text-gray-500 dark:text-gray-500">Root:</span>
                      <p className="text-gray-700 dark:text-gray-300 font-mono text-xs break-all">
                        {diagnostics.repositoryRoot}
                      </p>
                    </div>
                    {diagnostics.repositoryUuid && (
                      <div>
                        <span className="text-gray-500 dark:text-gray-500">UUID:</span>
                        <p className="text-gray-700 dark:text-gray-300 font-mono text-xs">
                          {diagnostics.repositoryUuid}
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Authentication Status */}
              <div className="p-4 bg-gray-50 dark:bg-gray-900 rounded-lg">
                <div className="flex items-center gap-2 mb-2">
                  <Key className="w-5 h-5 text-gray-600 dark:text-gray-400" />
                  <h3 className="font-medium text-gray-900 dark:text-gray-100">Authentication</h3>
                </div>
                {diagnostics.hasCredentials ? (
                  <div className="space-y-1 text-sm">
                    <div className="flex items-center gap-2">
                      <Check className="w-4 h-4 text-green-500" />
                      <span className="text-green-600 dark:text-green-400">Credentials found</span>
                    </div>
                    {diagnostics.credentialUsername && (
                      <p className="text-gray-600 dark:text-gray-400 pl-6">
                        Username:{' '}
                        <span className="font-mono">{diagnostics.credentialUsername}</span>
                      </p>
                    )}
                    {diagnostics.credentialRealm && (
                      <p
                        className="text-gray-500 dark:text-gray-500 pl-6 font-mono text-xs truncate"
                        title={diagnostics.credentialRealm}
                      >
                        Realm: {diagnostics.credentialRealm}
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-yellow-500" />
                    <span className="text-yellow-600 dark:text-yellow-400">
                      No credentials stored
                    </span>
                  </div>
                )}
              </div>

              {/* Connection Status */}
              <div className="p-4 bg-gray-50 dark:bg-gray-900 rounded-lg">
                <div className="flex items-center gap-2 mb-2">
                  {diagnostics.connectionStatus === 'ok' ? (
                    <Wifi className="w-5 h-5 text-green-500" />
                  ) : (
                    <WifiOff className="w-5 h-5 text-gray-400" />
                  )}
                  <h3 className="font-medium text-gray-900 dark:text-gray-100">Connection</h3>
                </div>
                <div className="flex items-center gap-2">
                  {getStatusIcon(diagnostics.connectionStatus)}
                  <span className={getStatusText(diagnostics.connectionStatus).className}>
                    {getStatusText(diagnostics.connectionStatus).text}
                  </span>
                </div>
                {diagnostics.connectionError && (
                  <p className="mt-2 text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 p-2 rounded">
                    {diagnostics.connectionError}
                  </p>
                )}
                {actionError && (
                  <p className="mt-2 text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 p-2 rounded">
                    {actionError}
                  </p>
                )}
              </div>
            </>
          ) : null}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
          <div className="flex items-center gap-3">
            {copyStatus === 'failed' && (
              <span className="text-xs text-red-600 dark:text-red-400">Copy failed</span>
            )}
            {diagnostics?.connectionStatus === 'ssl-error' &&
              diagnostics.repositoryUrl &&
              diagnostics.connectionError && (
                <button
                  onClick={handleTrustCertificate}
                  disabled={isTrustingCertificate}
                  className="px-4 py-2 bg-yellow-600 text-white rounded hover:bg-yellow-700 disabled:opacity-50 text-sm font-medium"
                >
                  {isTrustingCertificate ? (
                    <>
                      <Loader className="w-4 h-4 inline mr-2 animate-spin" />
                      Re-trusting…
                    </>
                  ) : (
                    <>
                      <Shield className="w-4 h-4 inline mr-2" />
                      Re-trust Certificate
                    </>
                  )}
                </button>
              )}
            {diagnostics && !diagnostics.hasCredentials && onAuthenticate && (
              <button
                onClick={() => {
                  onAuthenticate();
                  onClose();
                }}
                className="px-4 py-2 bg-accent text-white rounded hover:bg-accent/90 text-sm font-medium"
              >
                Authenticate
              </button>
            )}
          </div>
          <div className="flex-1" />
          <button
            onClick={onClose}
            className="px-4 py-2 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded text-sm"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
