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
} from 'lucide-react';
import { useState, useEffect } from 'react';
import type { RepoDiagnostics } from '@shared/types';
import { redactDiagnosticText } from './ErrorBoundary/redaction';

interface RepoDiagnosticsProps {
  workingCopyPath: string;
  onClose: () => void;
  onAuthenticate?: () => void;
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

  const {
    data: diagnostics,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['diagnostics', workingCopyPath],
    queryFn: () => window.api.svn.diagnostics(workingCopyPath),
    staleTime: 30000, // 30 seconds
  });

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await refetch();
    setIsRefreshing(false);
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

  // Handle keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
      if (e.key === 'r' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        handleRefresh();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const getStatusIcon = (status: RepoDiagnostics['connectionStatus']) => {
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
  };

  const getStatusText = (status: RepoDiagnostics['connectionStatus']) => {
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
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-lg mx-4 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            Repository Diagnostics
          </h2>
          <div className="flex items-center gap-2">
            <button
              onClick={handleCopyDiagnostics}
              disabled={!diagnostics}
              className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50"
              title="Copy redacted diagnostics"
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
            >
              <RefreshCw
                className={`w-4 h-4 text-gray-600 dark:text-gray-400 ${isRefreshing ? 'animate-spin' : ''}`}
              />
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700"
              title="Close (Esc)"
            >
              <X className="w-4 h-4 text-gray-600 dark:text-gray-400" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="p-4 space-y-4 max-h-[70vh] overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader className="w-6 h-6 animate-spin text-accent" />
              <span className="ml-2 text-gray-600 dark:text-gray-400">Running diagnostics...</span>
            </div>
          ) : error ? (
            <div className="p-4 bg-red-50 dark:bg-red-900/20 rounded-lg border border-red-200 dark:border-red-800">
              <p className="text-red-700 dark:text-red-400">Failed to run diagnostics</p>
              <p className="text-sm text-red-600 dark:text-red-500 mt-1">
                {(error as Error).message}
              </p>
            </div>
          ) : diagnostics ? (
            <>
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
