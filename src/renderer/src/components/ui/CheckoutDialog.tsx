import { lazy, Suspense, useState, useEffect } from 'react';
import {
  X,
  Download,
  FolderOpen,
  AlertCircle,
  CheckCircle,
  Loader2,
  Lock,
  User,
  Key,
  ChevronDown,
} from 'lucide-react';
import { useSettings } from '@renderer/hooks/useSettings';
import {
  CheckoutAuthPrompt,
  CheckoutSslPrompt,
  type SslCertificate,
} from '../checkout/CheckoutPrompts';

const ChooseItemsDialog = lazy(() =>
  import('./ChooseItemsDialog').then((m) => ({ default: m.ChooseItemsDialog }))
);

interface CheckoutDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onComplete?: (path: string) => void;
  initialUrl?: string;
}

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

export function CheckoutDialog({
  isOpen,
  onClose,
  onComplete,
  initialUrl = '',
}: CheckoutDialogProps) {
  const { settings } = useSettings();
  const [url, setUrl] = useState(initialUrl);
  const [path, setPath] = useState('');
  const [revision, setRevision] = useState('HEAD');
  const [depth, setDepth] = useState<'empty' | 'files' | 'immediates' | 'infinity'>('infinity');
  const [isCheckingOut, setIsCheckingOut] = useState(false);
  const [error, setError] = useState<string | null>(null);
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

  useEffect(() => {
    if (isOpen) {
      setUrl(initialUrl);
      // Pre-fill with default checkout directory from settings
      setPath(settings?.defaultCheckoutDirectory || '');
      setRevision('HEAD');
      setDepth('infinity');
      setError(null);
      setSuccess(null);
      setIsCheckingOut(false);
      // Reset auth/ssl state
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
    }
  }, [isOpen, initialUrl, settings?.defaultCheckoutDirectory]);

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

  // Handle SSL trust decision
  const handleSslTrust = async () => {
    if (!sslCertificate) return;

    setShowSslPrompt(false);
    setIsCheckingOut(true);
    setError(null);

    try {
      // Use selected paths if available, otherwise use depth
      const sparsePaths = selectedPaths.length > 0 ? selectedPaths : undefined;

      // If we have selected paths, override depth to empty since we're doing sparse checkout
      const checkoutDepth = sparsePaths ? 'empty' : depth;

      const result = await window.api.svn.checkout(
        url.trim(),
        path.trim(),
        revision === 'HEAD' ? undefined : revision,
        checkoutDepth,
        { trustSsl: true, trustPermanently, sslFailures, sparsePaths }
      );

      if (result.success) {
        setSuccess({ revision: result.revision ?? 0, path: path.trim() });
      } else {
        // Check for auth error after SSL trust
        const parsedAuthRealm = parseAuthError(result.output || '');
        if (parsedAuthRealm) {
          setAuthRealm(parsedAuthRealm);
          setShowAuth(true);
        } else {
          setError(result.output || 'Checkout failed');
        }
      }
    } catch (err) {
      const errorMsg = (err as Error).message || 'Checkout failed';
      // Check for auth error
      const realm = parseAuthError(errorMsg);
      if (realm) {
        setAuthRealm(realm);
        setShowAuth(true);
      } else {
        setError(errorMsg);
      }
    } finally {
      setIsCheckingOut(false);
    }
  };

  // Handle auth submission
  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!username.trim()) {
      setError('Please enter a username');
      return;
    }

    setShowAuth(false);
    setIsCheckingOut(true);
    setError(null);

    try {
      // Use selected paths if available, otherwise use depth
      const sparsePaths = selectedPaths.length > 0 ? selectedPaths : undefined;

      // If we have selected paths, override depth to empty since we're doing sparse checkout
      const checkoutDepth = sparsePaths ? 'empty' : depth;

      const result = await window.api.svn.checkout(
        url.trim(),
        path.trim(),
        revision === 'HEAD' ? undefined : revision,
        checkoutDepth,
        {
          credentials: { username: username.trim(), password },
          trustSsl: sslCertificate !== null,
          trustPermanently,
          sslFailures,
          sparsePaths,
        }
      );

      if (result.success) {
        setSuccess({ revision: result.revision ?? 0, path: path.trim() });
      } else {
        handleCheckoutError(result.output || 'Checkout failed');
      }
    } catch (err) {
      setError((err as Error).message || 'Checkout failed');
    } finally {
      setIsCheckingOut(false);
    }
  };

  // Handle checkout error - check for SSL/Auth requirements
  const handleCheckoutError = (errorMsg: string) => {
    // Check for SSL certificate error first
    const sslInfo = parseSslError(errorMsg);
    if (sslInfo) {
      setSslCertificate(sslInfo.certificate);
      setSslFailures(sslInfo.failures);
      setShowSslPrompt(true);
      return;
    }

    // Check for auth error
    const realm = parseAuthError(errorMsg);
    if (realm) {
      setAuthRealm(realm);
      setShowAuth(true);
      return;
    }

    // Generic error
    setError(errorMsg);
  };

  const handleBrowsePath = async () => {
    const result = await window.api.dialog.openDirectory();
    if (result) {
      setPath(result);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!url.trim()) {
      setError('Please enter a repository URL');
      return;
    }

    if (!path.trim()) {
      setError('Please select a destination folder');
      return;
    }

    setIsCheckingOut(true);
    setError(null);

    try {
      // If user proactively provided credentials, use them
      const options = provideCredentials
        ? {
            credentials: { username: username.trim(), password },
          }
        : undefined;

      // Use selected paths if available, otherwise use depth
      const sparsePaths = selectedPaths.length > 0 ? selectedPaths : undefined;

      // If we have selected paths, override depth to empty since we're doing sparse checkout
      const checkoutDepth = sparsePaths ? 'empty' : depth;

      const result = await window.api.svn.checkout(
        url.trim(),
        path.trim(),
        revision === 'HEAD' ? undefined : revision,
        checkoutDepth,
        { ...options, sparsePaths }
      );

      if (result.success) {
        // Save credentials if requested
        if (provideCredentials && saveCredentials && username.trim()) {
          try {
            const realm =
              authRealm || url.trim().match(/^(https?:\/\/[^/]+)/)?.[1] || url.trim();
            await window.api.auth.set(realm, username.trim(), password);
          } catch {
            // Ignore credential save errors
          }
        }
        setSuccess({ revision: result.revision ?? 0, path: path.trim() });
      } else {
        handleCheckoutError(result.output || 'Checkout failed');
      }
    } catch (err) {
      handleCheckoutError((err as Error).message || 'Checkout failed');
    } finally {
      setIsCheckingOut(false);
    }
  };

  const handleClose = () => {
    if (!isCheckingOut) {
      if (success && onComplete) {
        onComplete(success.path);
      }
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <>
      {/* Main Checkout Dialog */}
      <div className="modal-overlay" onClick={handleClose}>
        <div className="modal w-[560px]" onClick={(e) => e.stopPropagation()}>
          {/* Header */}
          <div className="modal-header">
            <h2 className="modal-title">
              <Download className="w-5 h-5 text-accent" />
              Checkout from Repository
            </h2>
            <button onClick={handleClose} className="btn-icon-sm" disabled={isCheckingOut}>
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Content */}
          {success ? (
            <div className="modal-body">
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
            </div>
          ) : (
            <form onSubmit={handleSubmit}>
              <div className="modal-body space-y-4">
                {/* Repository URL */}
                <div>
                  <label
                    htmlFor="checkout-url"
                    className="text-sm font-medium text-text-secondary mb-1.5 block"
                  >
                    URL of repository <span className="text-error">*</span>
                  </label>
                  <input
                    id="checkout-url"
                    type="text"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder="svn://example.com/repo/trunk"
                    className="input"
                    disabled={isCheckingOut}
                  />
                </div>

                {/* Destination Path */}
                <div>
                  <label
                    htmlFor="checkout-path"
                    className="text-sm font-medium text-text-secondary mb-1.5 block"
                  >
                    Checkout directory <span className="text-error">*</span>
                  </label>
                  <div className="flex gap-2">
                    <input
                      id="checkout-path"
                      type="text"
                      value={path}
                      onChange={(e) => setPath(e.target.value)}
                      placeholder="C:\Projects\my-project"
                      className="input flex-1"
                      disabled={isCheckingOut}
                    />
                    <button
                      type="button"
                      onClick={handleBrowsePath}
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
                  <label
                    htmlFor="checkout-revision"
                    className="text-sm font-medium text-text-secondary mb-1.5 block"
                  >
                    Revision
                  </label>
                  <input
                    id="checkout-revision"
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
                    <label
                      htmlFor="checkout-depth"
                      className="text-sm font-medium text-text-secondary"
                    >
                      Checkout depth
                    </label>
                    {selectedPaths.length > 0 && (
                      <span className="text-xs text-accent">
                        {selectedPaths.length} items selected
                      </span>
                    )}
                  </div>
                  <select
                    id="checkout-depth"
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

                {url.trim() && (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setShowChooseItemsDialog(true)}
                      className="btn btn-ghost text-sm"
                      disabled={isCheckingOut}
                    >
                      Choose items…
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
                          <label
                            htmlFor="checkout-provided-username"
                            className="text-xs font-medium text-text-secondary mb-1 block flex items-center gap-1.5"
                          >
                            <User className="w-3.5 h-3.5" />
                            Username
                          </label>
                          <input
                            id="checkout-provided-username"
                            type="text"
                            value={username}
                            onChange={(e) => setUsername(e.target.value)}
                            placeholder="Optional"
                            className="input text-sm"
                            disabled={isCheckingOut}
                          />
                        </div>
                        <div>
                          <label
                            htmlFor="checkout-provided-password"
                            className="text-xs font-medium text-text-secondary mb-1 block flex items-center gap-1.5"
                          >
                            <Key className="w-3.5 h-3.5" />
                            Password
                          </label>
                          <input
                            id="checkout-provided-password"
                            type="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            placeholder="Optional"
                            className="input text-sm"
                            disabled={isCheckingOut}
                          />
                        </div>
                      </div>
                      <label
                        htmlFor="checkout-save-credentials"
                        className="flex items-center gap-2 text-xs cursor-pointer"
                      >
                        <input
                          id="checkout-save-credentials"
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
              </div>

              {/* Footer */}
              <div className="modal-footer">
                <button
                  type="button"
                  onClick={handleClose}
                  className="btn btn-secondary"
                  disabled={isCheckingOut}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={isCheckingOut || !url.trim() || !path.trim()}
                >
                  {isCheckingOut ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Checking out…
                    </>
                  ) : (
                    <>
                      <Download className="w-4 h-4" />
                      Checkout
                    </>
                  )}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>

      {/* SSL Certificate Trust Prompt */}
      {showSslPrompt && sslCertificate && (
        <CheckoutSslPrompt
          certificate={sslCertificate}
          failures={sslFailures}
          trustPermanently={trustPermanently}
          onTrustPermanentlyChange={setTrustPermanently}
          onReject={() => {
            setShowSslPrompt(false);
            setSslCertificate(null);
            setError('Certificate rejected by user');
          }}
          onTrust={handleSslTrust}
        />
      )}

      {/* Authentication Prompt */}
      {showAuth && (
        <CheckoutAuthPrompt
          realm={authRealm}
          username={username}
          password={password}
          onUsernameChange={setUsername}
          onPasswordChange={setPassword}
          onCancel={() => {
            setShowAuth(false);
            setAuthRealm(null);
            setError('Authentication cancelled');
          }}
          onSubmit={handleAuthSubmit}
        />
      )}

      {/* Choose Items Dialog */}
      {showChooseItemsDialog && (
        <Suspense fallback={null}>
          <ChooseItemsDialog
            isOpen={showChooseItemsDialog}
            repoUrl={url}
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
        </Suspense>
      )}
    </>
  );
}
