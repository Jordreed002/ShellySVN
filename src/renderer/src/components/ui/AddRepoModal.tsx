import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  X,
  FolderOpen,
  GitBranch,
  Download,
  Clock,
  ChevronRight,
  AlertCircle,
  CheckCircle,
  Loader2,
  Upload,
  Lock,
  Shield,
  User,
  Key,
  ChevronDown,
  XCircle,
} from 'lucide-react';
import { useSettings } from '@renderer/hooks/useSettings';
import { ChooseItemsDialog } from './ChooseItemsDialog';
import type { AppSettings, CheckoutProgress } from '@shared/types';

interface SslCertificate {
  fingerprint: string;
  subject?: string;
  issuer?: string;
  validFrom?: string;
  validUntil?: string;
}

interface AddRepoModalProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenRepo: (path: string) => void;
  onImport?: () => void;
  recentRepos?: AppSettings['recentRepositories'];
  initialTab?: 'open' | 'checkout' | 'import';
}

export function AddRepoModal({
  isOpen,
  onClose,
  onOpenRepo,
  onImport,
  recentRepos = [],
  initialTab = 'open',
}: AddRepoModalProps) {
  const { settings } = useSettings();
  const [mode, setMode] = useState<'open' | 'checkout' | 'import'>(initialTab);

  // Open Working Copy state
  const [selectedPath, setSelectedPath] = useState<string>('');
  const [isChecking, setIsChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Checkout state
  const [checkoutUrl, setCheckoutUrl] = useState('');
  const [checkoutPath, setCheckoutPath] = useState('');
  const [revision, setRevision] = useState('HEAD');
  const [depth, setDepth] = useState<'empty' | 'files' | 'immediates' | 'infinity'>('infinity');
  const [isCheckingOut, setIsCheckingOut] = useState(false);
  const [success, setSuccess] = useState<{ revision: number; path: string } | null>(null);

  // Auth state
  const [showAuth, setShowAuth] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [authRealm, setAuthRealm] = useState<string | null>(null);
  const [provideCredentials, setProvideCredentials] = useState(false);
  const [saveCredentials, setSaveCredentials] = useState(false);

  // SSL state
  const [showSslPrompt, setShowSslPrompt] = useState(false);
  const [sslCertificate, setSslCertificate] = useState<SslCertificate | null>(null);
  const [trustPermanently, setTrustPermanently] = useState(false);
  const [sslFailures, setSslFailures] = useState<string[]>([]);

  // ChooseItemsDialog state
  const [showChooseItemsDialog, setShowChooseItemsDialog] = useState(false);
  const [selectedPaths, setSelectedPaths] = useState<string[]>([]);

  // Checkout progress state
  const [checkoutProgress, setCheckoutProgress] = useState<{
    currentFile?: string;
    filesProcessed: number;
    status: 'running' | 'completed' | 'cancelled' | 'error' | 'idle';
  }>({
    filesProcessed: 0,
    status: 'idle',
  });

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setMode(initialTab);
      setSelectedPath('');
      setError(null);
      setIsChecking(false);
      // Checkout state
      setCheckoutUrl('');
      setCheckoutPath(settings?.defaultCheckoutDirectory || '');
      setRevision('HEAD');
      setDepth('infinity');
      setSuccess(null);
      setIsCheckingOut(false);
      // Auth/SSL state
      setShowAuth(false);
      setUsername('');
      setPassword('');
      setAuthRealm(null);
      setShowSslPrompt(false);
      setSslCertificate(null);
      setTrustPermanently(false);
      setSslFailures([]);
      setProvideCredentials(false);
      setSaveCredentials(false);
      setSelectedPaths([]);
      // Reset checkout progress
      setCheckoutProgress({
        filesProcessed: 0,
        status: 'idle',
      });
    }
  }, [isOpen, initialTab, settings?.defaultCheckoutDirectory]);

  // Auto-fill saved credentials when auth dialog appears
  useEffect(() => {
    if (showAuth && authRealm) {
      window.api.auth
        .get(authRealm)
        .then((savedCreds) => {
          if (savedCreds) {
            setUsername(savedCreds.username);
            setPassword(savedCreds.password);
          }
        })
        .catch(() => {
          // Ignore errors - user can type manually
        });
    }
  }, [showAuth, authRealm]);

  // === Open Working Copy handlers ===
  const handleBrowse = async () => {
    const path = await window.api.dialog.openDirectory();
    if (path) {
      setSelectedPath(path);
      setError(null);
    }
  };

  const handleOpen = async () => {
    if (!selectedPath) {
      setError('Please select a folder');
      return;
    }

    setIsChecking(true);
    setError(null);

    try {
      const info = await window.api.svn.info(selectedPath);
      if (info) {
        onOpenRepo(selectedPath);
        onClose();
      }
    } catch {
      setError('Selected folder is not a valid SVN working copy');
    } finally {
      setIsChecking(false);
    }
  };

  const handleRecentClick = (path: string) => {
    onOpenRepo(path);
    onClose();
  };

  // === Checkout handlers ===
  const parseSslError = (
    errorMsg: string
  ): { certificate: SslCertificate; failures: string[] } | null => {
    if (!errorMsg.includes('certificate') && !errorMsg.includes('SSL')) {
      return null;
    }

    const fingerprintMatch = errorMsg.match(/Fingerprint:\s*([a-fA-F0-9:]+)/i);
    const subjectMatch = errorMsg.match(/Hostname:\s*(.+)/i);
    const issuerMatch = errorMsg.match(/Issuer:\s*(.+?)(?:\n|$)/i);
    const validFromMatch = errorMsg.match(/Valid:\s*from\s+(.+?)\s+until/i);
    const validUntilMatch = errorMsg.match(/until\s+(.+?)(?:\n|$)/i);

    const failures: string[] = [];
    if (errorMsg.match(/not issued by a trusted authority|issuer is not trusted/i)) {
      failures.push('untrusted-issuer');
    }
    if (errorMsg.match(/hostname does not match|certificate issued for a different hostname/i)) {
      failures.push('hostname-mismatch');
    }
    if (errorMsg.includes('has expired')) {
      failures.push('expired');
    }
    if (errorMsg.includes('not yet valid')) {
      failures.push('not-yet-valid');
    }

    if (failures.length > 0 || fingerprintMatch) {
      return {
        certificate: {
          fingerprint: fingerprintMatch?.[1] || 'Unknown',
          subject: subjectMatch?.[1]?.trim(),
          issuer: issuerMatch?.[1]?.trim(),
          validFrom: validFromMatch?.[1]?.trim(),
          validUntil: validUntilMatch?.[1]?.trim(),
        },
        failures: failures.length > 0 ? failures : ['unknown-ca'],
      };
    }

    return null;
  };

  const parseAuthError = (errorMsg: string): string | null => {
    if (
      errorMsg.includes('credentials') ||
      errorMsg.includes('Authentication') ||
      errorMsg.includes('authorization')
    ) {
      const realmMatch = errorMsg.match(/Authentication realm:\s*<[^>]+>\s*(.+)/i);
      if (realmMatch) {
        return realmMatch[1].trim();
      }
      const urlMatch = errorMsg.match(/https?:\/\/([^/]+)/);
      if (urlMatch) {
        return urlMatch[1];
      }
      return 'SVN Repository';
    }
    return null;
  };

  const handleCheckoutError = (errorMsg: string) => {
    const sslInfo = parseSslError(errorMsg);
    if (sslInfo) {
      setSslCertificate(sslInfo.certificate);
      setSslFailures(sslInfo.failures);
      setShowSslPrompt(true);
      return;
    }

    const realm = parseAuthError(errorMsg);
    if (realm) {
      setAuthRealm(realm);
      setShowAuth(true);
      return;
    }

    setError(errorMsg);
  };

  const executeCheckout = async (
    options?: {
      credentials?: { username: string; password: string };
      trustSsl?: boolean;
    },
    e?: React.FormEvent
  ) => {
    if (e) e.preventDefault();

    if (!checkoutUrl.trim()) {
      setError('Please enter a repository URL');
      return;
    }

    if (!checkoutPath.trim()) {
      setError('Please select a destination folder');
      return;
    }

    setIsCheckingOut(true);
    setError(null);
    setCheckoutProgress({ filesProcessed: 0, status: 'running' });

    try {
      const sparsePaths = selectedPaths.length > 0 ? selectedPaths : undefined;
      const checkoutDepth = sparsePaths ? 'empty' : depth;

      const checkoutOptions = {
        ...options,
        sparsePaths,
        trustPermanently,
        sslFailures,
      };

      const result = await window.api.svn.checkoutWithProgress(
        checkoutUrl.trim(),
        checkoutPath.trim(),
        (progress: CheckoutProgress) => {
          setCheckoutProgress({
            currentFile: progress.currentFile,
            filesProcessed: progress.filesProcessed,
            status: progress.status,
          });

          if (progress.status === 'completed') {
            // Handle success
            setSuccess({ revision: progress.revision || 0, path: checkoutPath.trim() });
          } else if (progress.status === 'error') {
            setError(progress.error || 'Checkout failed');
          }
        },
        revision === 'HEAD' ? undefined : revision,
        checkoutDepth,
        checkoutOptions
      );

      if (result.success) {
        if (provideCredentials && saveCredentials && username.trim()) {
          try {
            const realm = checkoutUrl.trim().match(/^(https?:\/\/[^/]+)/)?.[1] || checkoutUrl.trim();
            await window.api.auth.set(realm, username.trim(), password);
          } catch {
            // Ignore credential save errors
          }
        }
        setSuccess({ revision: result.revision, path: checkoutPath.trim() });
      } else {
        handleCheckoutError(result.output || 'Checkout failed');
      }
    } catch (err) {
      handleCheckoutError((err as Error).message || 'Checkout failed');
    } finally {
      setIsCheckingOut(false);
      setCheckoutProgress((prev) => ({ ...prev, status: 'idle' }));
    }
  };

  const handleSslTrust = async () => {
    if (!sslCertificate) return;

    setShowSslPrompt(false);
    await executeCheckout({ trustSsl: true });
  };

  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!username.trim()) {
      setError('Please enter a username');
      return;
    }

    setShowAuth(false);
    await executeCheckout({
      credentials: { username: username.trim(), password },
      trustSsl: sslCertificate !== null,
    });
  };

  const handleBrowseCheckoutPath = async () => {
    const result = await window.api.dialog.openDirectory();
    if (result) {
      setCheckoutPath(result);
    }
  };

  const handleCancelCheckout = useCallback(async () => {
    await window.api.svn.cancelCheckout();
    setIsCheckingOut(false);
    setCheckoutProgress((prev) => ({ ...prev, status: 'cancelled' }));
    setError('Checkout cancelled');
  }, []);

  const handleClose = () => {
    if (mode === 'checkout' && isCheckingOut) return;
    if (isChecking) return;

    if (success) {
      onOpenRepo(success.path);
    }
    onClose();
  };

  if (!isOpen) return null;

  const modalContent = (
    <div className="modal-overlay" onClick={handleClose}>
      <div
        className="modal w-[600px] max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="modal-header flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-accent/10 flex items-center justify-center">
              {mode === 'checkout' ? (
                <Download className="w-5 h-5 text-accent" />
              ) : mode === 'import' ? (
                <Upload className="w-5 h-5 text-accent" />
              ) : (
                <FolderOpen className="w-5 h-5 text-accent" />
              )}
            </div>
            <div>
              <h2 className="text-lg font-semibold text-text">
                {mode === 'checkout'
                  ? 'Checkout from Repository'
                  : mode === 'import'
                    ? 'Import to Repository'
                    : 'Open Working Copy'}
              </h2>
              <p className="text-sm text-text-secondary">
                {mode === 'checkout'
                  ? 'Download a working copy from a remote repository'
                  : mode === 'import'
                    ? 'Upload a local folder to a repository'
                    : 'Open an existing SVN working copy'}
              </p>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="btn-icon-sm"
            disabled={isChecking || isCheckingOut}
            data-testid="modal-close-button"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-border flex-shrink-0">
          <button
            onClick={() => {
              setMode('open');
              setError(null);
            }}
            className={`flex-1 px-4 py-3 text-sm font-medium transition-fast ${
              mode === 'open'
                ? 'text-accent border-b-2 border-accent'
                : 'text-text-secondary hover:text-text'
            }`}
          >
            Open Working Copy
          </button>
          <button
            onClick={() => {
              setMode('checkout');
              setError(null);
            }}
            className={`flex-1 px-4 py-3 text-sm font-medium transition-fast ${
              mode === 'checkout'
                ? 'text-accent border-b-2 border-accent'
                : 'text-text-secondary hover:text-text'
            }`}
          >
            Checkout from URL
          </button>
          <button
            onClick={() => {
              setMode('import');
              setError(null);
            }}
            className={`flex-1 px-4 py-3 text-sm font-medium transition-fast ${
              mode === 'import'
                ? 'text-accent border-b-2 border-accent'
                : 'text-text-secondary hover:text-text'
            }`}
          >
            Import
          </button>
        </div>

        {/* Body */}
        <div className="modal-body flex-1 overflow-auto min-h-0">
          {mode === 'open' ? (
            <div className="space-y-4">
              {/* Browse Section */}
              <div>
                <label className="block text-sm font-medium text-text mb-2">
                  Working Copy Path
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={selectedPath}
                    onChange={(e) => setSelectedPath(e.target.value)}
                    placeholder="Select a folder containing an SVN working copy..."
                    className="input flex-1"
                    readOnly
                  />
                  <button onClick={handleBrowse} className="btn btn-secondary">
                    <FolderOpen className="w-4 h-4" />
                    Browse
                  </button>
                </div>
              </div>

              {/* Recent Repositories */}
              {recentRepos.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 text-sm text-text-secondary mb-2">
                    <Clock className="w-4 h-4" />
                    <span>Recent Repositories</span>
                  </div>
                  <div className="space-y-1 max-h-[200px] overflow-y-auto scrollbar-overlay">
                    {recentRepos.map((repo) => (
                      <button
                        key={repo}
                        onClick={() => handleRecentClick(repo)}
                        className="w-full flex items-center gap-3 px-3 py-2 rounded-md text-left hover:bg-bg-tertiary transition-fast group"
                      >
                        <FolderOpen className="w-4 h-4 text-accent flex-shrink-0" />
                        <span className="flex-1 truncate text-sm text-text-secondary group-hover:text-text">
                          {repo}
                        </span>
                        <ChevronRight className="w-4 h-4 text-text-faint opacity-0 group-hover:opacity-100 transition-fast" />
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : mode === 'checkout' ? (
            success ? (
              <div className="flex flex-col items-center py-8 text-center">
                <div className="w-12 h-12 rounded-full bg-success/20 flex items-center justify-center mb-4">
                  <CheckCircle className="w-6 h-6 text-success" />
                </div>
                <h3 className="text-lg font-medium text-text mb-2">Checkout Complete</h3>
                <p className="text-text-secondary mb-2">Checked out revision {success.revision}</p>
                <p className="text-text-faint text-sm mb-6 break-all">{success.path}</p>
                <button onClick={handleClose} className="btn btn-primary">
                  Done
                </button>
              </div>
            ) : (
              <form onSubmit={(e) => executeCheckout(undefined, e)} className="space-y-4">
                {/* Repository URL */}
                <div>
                  <label className="text-sm font-medium text-text-secondary mb-1.5 block">
                    URL of repository <span className="text-error">*</span>
                  </label>
                  <input
                    type="text"
                    value={checkoutUrl}
                    onChange={(e) => setCheckoutUrl(e.target.value)}
                    placeholder="svn://example.com/repo/trunk"
                    className="input"
                    disabled={isCheckingOut}
                  />
                </div>

                {/* Destination Path */}
                <div>
                  <label className="text-sm font-medium text-text-secondary mb-1.5 block">
                    Checkout directory <span className="text-error">*</span>
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={checkoutPath}
                      onChange={(e) => setCheckoutPath(e.target.value)}
                      placeholder="Select destination folder..."
                      className="input flex-1"
                      disabled={isCheckingOut}
                    />
                    <button
                      type="button"
                      onClick={handleBrowseCheckoutPath}
                      className="btn btn-secondary"
                      disabled={isCheckingOut}
                    >
                      <FolderOpen className="w-4 h-4" />
                      Browse
                    </button>
                  </div>
                </div>

                {/* Revision */}
                <div>
                  <label className="text-sm font-medium text-text-secondary mb-1.5 block">
                    Revision
                  </label>
                  <input
                    type="text"
                    value={revision}
                    onChange={(e) => setRevision(e.target.value)}
                    placeholder="HEAD"
                    className="input w-32"
                    disabled={isCheckingOut}
                  />
                  <span className="text-xs text-text-faint ml-2">HEAD = latest</span>
                </div>

                {/* Depth */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-sm font-medium text-text-secondary">Checkout depth</label>
                    {selectedPaths.length > 0 && (
                      <span className="text-xs text-accent">
                        {selectedPaths.length} items selected
                      </span>
                    )}
                  </div>
                  <select
                    value={depth}
                    onChange={(e) => setDepth(e.target.value as typeof depth)}
                    className="input"
                    disabled={isCheckingOut}
                  >
                    <option value="infinity">Fully recursive</option>
                    <option value="immediates">Immediate children</option>
                    <option value="files">Files only</option>
                    <option value="empty">Only this item</option>
                  </select>
                </div>

                {/* Checkout Progress */}
                {isCheckingOut && checkoutProgress.status === 'running' && (
                  <div className="space-y-2 p-3 bg-bg-secondary rounded-lg">
                    <div className="flex items-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin text-accent" />
                      <span className="text-sm text-text-secondary">
                        Checking out... {checkoutProgress.filesProcessed} files
                      </span>
                    </div>
                    {checkoutProgress.currentFile && (
                      <div className="text-xs text-text-faint truncate">
                        {checkoutProgress.currentFile}
                      </div>
                    )}
                  </div>
                )}

                {/* Choose Items */}
                {checkoutUrl.trim() && (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setShowChooseItemsDialog(true)}
                      className="btn btn-ghost text-sm"
                      disabled={isCheckingOut}
                    >
                      Choose items...
                    </button>
                    {selectedPaths.length > 0 && (
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedPaths([]);
                          setDepth('infinity');
                        }}
                        className="btn btn-ghost text-xs"
                      >
                        Clear selection
                      </button>
                    )}
                  </div>
                )}

                {/* Credentials Section */}
                <div className="border border-border rounded-lg">
                  <button
                    type="button"
                    onClick={() => setProvideCredentials(!provideCredentials)}
                    className="w-full flex items-center justify-between px-3 py-2 text-sm hover:bg-bg-tertiary transition-fast rounded-t-lg"
                    disabled={isCheckingOut}
                  >
                    <div className="flex items-center gap-2">
                      <Lock className="w-4 h-4 text-text-muted" />
                      <span className="text-text-secondary">Authentication</span>
                    </div>
                    <div className="flex items-center gap-2">
                      {provideCredentials && username.trim() && (
                        <span className="text-xs text-accent">{username}</span>
                      )}
                      <ChevronDown
                        className={`w-4 h-4 text-text-muted transition-transform ${provideCredentials ? 'rotate-180' : ''}`}
                      />
                    </div>
                  </button>

                  {provideCredentials && (
                    <div className="px-3 pb-3 pt-2 border-t border-border space-y-3">
                      <p className="text-xs text-text-muted">
                        Provide credentials if your repository requires authentication. Leave empty
                        for anonymous access.
                      </p>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="text-xs font-medium text-text-secondary mb-1 block flex items-center gap-1.5">
                            <User className="w-3.5 h-3.5" />
                            Username
                          </label>
                          <input
                            type="text"
                            value={username}
                            onChange={(e) => setUsername(e.target.value)}
                            placeholder="Optional"
                            className="input text-sm"
                            disabled={isCheckingOut}
                          />
                        </div>
                        <div>
                          <label className="text-xs font-medium text-text-secondary mb-1 block flex items-center gap-1.5">
                            <Key className="w-3.5 h-3.5" />
                            Password
                          </label>
                          <input
                            type="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            placeholder="Optional"
                            className="input text-sm"
                            disabled={isCheckingOut}
                          />
                        </div>
                      </div>
                      <label className="flex items-center gap-2 text-xs cursor-pointer">
                        <input
                          type="checkbox"
                          checked={saveCredentials}
                          onChange={(e) => setSaveCredentials(e.target.checked)}
                          className="checkbox"
                          disabled={isCheckingOut}
                        />
                        <span className="text-text-secondary">
                          Save credentials for this repository
                        </span>
                      </label>
                    </div>
                  )}
                </div>

                {/* Error */}
                {error && (
                  <div className="flex items-center gap-2 text-sm text-error bg-error/10 rounded p-2">
                    <AlertCircle className="w-4 h-4 flex-shrink-0" />
                    <span>{error}</span>
                  </div>
                )}
              </form>
            )
          ) : (
            <div className="space-y-4">
              {/* Import Description */}
              <div className="flex items-start gap-3 p-4 bg-accent/5 border border-accent/20 rounded-lg">
                <Upload className="w-5 h-5 text-accent flex-shrink-0 mt-0.5" />
                <div>
                  <h3 className="text-sm font-medium text-text mb-1">Import to Repository</h3>
                  <p className="text-xs text-text-secondary">
                    Upload a local folder to a repository location. This creates a new directory in
                    the repository containing the contents of your local folder.
                  </p>
                </div>
              </div>

              {/* Import Info */}
              <div className="text-sm text-text-secondary">
                <p>
                  The Import dialog allows you to upload an unversioned folder to an SVN repository.
                  You will be able to specify the source folder, destination URL, and commit
                  message.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="modal-footer flex-shrink-0">
          <button onClick={handleClose} className="btn btn-ghost" disabled={isChecking || isCheckingOut}>
            Cancel
          </button>
          {mode === 'open' ? (
            <button
              onClick={handleOpen}
              disabled={!selectedPath || isChecking}
              className="btn btn-primary"
            >
              {isChecking ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Verifying...
                </>
              ) : (
                <>
                  <CheckCircle className="w-4 h-4" />
                  Open
                </>
              )}
            </button>
          ) : mode === 'checkout' ? (
            success ? null : isCheckingOut ? (
              <button onClick={handleCancelCheckout} className="btn btn-danger">
                <XCircle className="w-4 h-4" />
                Cancel
              </button>
            ) : (
              <button
                onClick={() => executeCheckout()}
                disabled={isCheckingOut || !checkoutUrl.trim() || !checkoutPath.trim()}
                className="btn btn-primary"
              >
                <>
                  <Download className="w-4 h-4" />
                  Checkout
                </>
              </button>
            )
          ) : (
            <button
              onClick={() => {
                onImport?.();
                onClose();
              }}
              className="btn btn-primary"
            >
              <Upload className="w-4 h-4" />
              Open Import Dialog
            </button>
          )}
        </div>
      </div>

      {/* SSL Certificate Trust Prompt */}
      {showSslPrompt && sslCertificate && (
        <div className="modal-overlay" style={{ zIndex: 100 }}>
          <div className="modal w-[480px]" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">
                <Shield className="w-5 h-5 text-warning" />
                Certificate Verification Failed
              </h2>
            </div>

            <div className="modal-body space-y-4">
              <p className="text-text-secondary text-sm">
                The server's SSL certificate could not be verified. Review the certificate details
                below:
              </p>

              <div className="bg-surface-elevated rounded-lg p-4 space-y-2 font-mono text-xs">
                {sslCertificate.subject && (
                  <div className="flex">
                    <span className="text-text-faint w-24">Subject:</span>
                    <span className="text-text break-all">{sslCertificate.subject}</span>
                  </div>
                )}
                {sslCertificate.issuer && (
                  <div className="flex">
                    <span className="text-text-faint w-24">Issuer:</span>
                    <span className="text-text break-all">{sslCertificate.issuer}</span>
                  </div>
                )}
                {sslCertificate.validFrom && (
                  <div className="flex">
                    <span className="text-text-faint w-24">Valid from:</span>
                    <span className="text-text">{sslCertificate.validFrom}</span>
                  </div>
                )}
                {sslCertificate.validUntil && (
                  <div className="flex">
                    <span className="text-text-faint w-24">Valid until:</span>
                    <span className="text-text">{sslCertificate.validUntil}</span>
                  </div>
                )}
                <div className="flex">
                  <span className="text-text-faint w-24">Fingerprint:</span>
                  <span className="text-text break-all">{sslCertificate.fingerprint}</span>
                </div>
              </div>

              {sslFailures.length > 0 && (
                <div className="text-warning text-sm space-y-1">
                  <p className="font-medium">Issues:</p>
                  <ul className="list-disc list-inside text-text-secondary">
                    {sslFailures.includes('untrusted-issuer') && (
                      <li>Certificate is not issued by a trusted authority</li>
                    )}
                    {sslFailures.includes('hostname-mismatch') && (
                      <li>Certificate hostname does not match</li>
                    )}
                    {sslFailures.includes('expired') && <li>Certificate has expired</li>}
                    {sslFailures.includes('not-yet-valid') && (
                      <li>Certificate is not yet valid</li>
                    )}
                  </ul>
                </div>
              )}

              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={trustPermanently}
                  onChange={(e) => setTrustPermanently(e.target.checked)}
                  className="checkbox"
                />
                <span>Trust this certificate permanently</span>
              </label>
            </div>

            <div className="modal-footer">
              <button
                type="button"
                onClick={() => {
                  setShowSslPrompt(false);
                  setSslCertificate(null);
                  setError('Certificate rejected by user');
                }}
                className="btn btn-secondary"
              >
                Reject
              </button>
              <button type="button" onClick={handleSslTrust} className="btn btn-warning">
                <Shield className="w-4 h-4" />
                Trust Certificate
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Authentication Prompt */}
      {showAuth && (
        <div className="modal-overlay" style={{ zIndex: 100 }}>
          <div className="modal w-[400px]" onClick={(e) => e.stopPropagation()}>
            <form onSubmit={handleAuthSubmit}>
              <div className="modal-header">
                <h2 className="modal-title">
                  <Lock className="w-5 h-5 text-accent" />
                  Authentication Required
                </h2>
              </div>

              <div className="modal-body space-y-4">
                <p className="text-text-secondary text-sm">Please enter your credentials for:</p>

                {authRealm && (
                  <div className="bg-surface-elevated rounded px-3 py-2 text-sm text-text-secondary font-mono">
                    {authRealm}
                  </div>
                )}

                <div>
                  <label className="text-sm font-medium text-text-secondary mb-1.5 block flex items-center gap-2">
                    <User className="w-4 h-4" />
                    Username <span className="text-error">*</span>
                  </label>
                  <input
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="Enter username"
                    className="input"
                    autoFocus
                  />
                </div>

                <div>
                  <label className="text-sm font-medium text-text-secondary mb-1.5 block flex items-center gap-2">
                    <Key className="w-4 h-4" />
                    Password
                  </label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter password"
                    className="input"
                  />
                </div>
              </div>

              <div className="modal-footer">
                <button
                  type="button"
                  onClick={() => {
                    setShowAuth(false);
                    setAuthRealm(null);
                    setError('Authentication cancelled');
                  }}
                  className="btn btn-secondary"
                >
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={!username.trim()}>
                  <Lock className="w-4 h-4" />
                  Authenticate
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Choose Items Dialog */}
      {showChooseItemsDialog && (
        <ChooseItemsDialog
          isOpen={showChooseItemsDialog}
          repoUrl={checkoutUrl}
          credentials={
            provideCredentials && username.trim()
              ? {
                  username: username.trim(),
                  password,
                }
              : undefined
          }
          onSelect={(paths) => {
            setSelectedPaths(paths);
            setShowChooseItemsDialog(false);
          }}
          onCancel={() => setShowChooseItemsDialog(false)}
          title="Choose Items to Checkout"
        />
      )}
    </div>
  );

  return createPortal(modalContent, document.body);
}

// Compact "Add Repository" button/trigger
export function AddRepoButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-3 px-4 py-3 text-left rounded-lg border border-dashed border-border hover:border-accent hover:bg-accent/5 transition-all duration-200 group"
    >
      <div className="w-8 h-8 rounded-md bg-bg-tertiary flex items-center justify-center group-hover:bg-accent/20 transition-fast">
        <GitBranch className="w-4 h-4 text-text-secondary group-hover:text-accent" />
      </div>
      <div>
        <span className="text-sm font-medium text-text-secondary group-hover:text-text">
          Add Repository
        </span>
        <p className="text-xs text-text-muted">Open or checkout a working copy</p>
      </div>
    </button>
  );
}
