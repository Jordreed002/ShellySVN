import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, FolderGit2, KeyRound, Loader2 } from 'lucide-react';

import {
  isRepoBrowserAuthError,
  loadRepoBrowserCredentials,
  type RepoBrowserCredentials,
} from '@renderer/routes/repo-browser/-repoBrowserAuth';

import { RepoBrowserView } from './RepoBrowserView';

/**
 * Everything that has to happen before a repository can be browsed:
 * choosing a URL, reaching the server, and authenticating.
 *
 * `RepoBrowserView` assumes a reachable repository; this owns the states where
 * there isn't one yet. Keeping them apart means the browser itself never has to
 * reason about being disconnected.
 */

export interface RepoBrowserScreenProps {
  /** Repository URL from the route's search params. */
  url?: string;
  /** Local working-copy path from the route's search params. */
  localPath?: string;
  /**
   * Fired when the browser binds (or unbinds) a local checkout for the path on
   * screen, so the route can record it and the rest of the shell can agree.
   */
  onWorkingCopyBound?: (localPath: string | null) => void;
}

type Phase =
  | { kind: 'needs-url' }
  | { kind: 'connecting' }
  | { kind: 'needs-auth'; realm: string }
  | { kind: 'failed'; message: string }
  | { kind: 'connected' };

function isProbablyRepoUrl(value: string): boolean {
  return /^(svn|svn\+ssh|https?|file):\/\/.+/i.test(value.trim());
}

export function RepoBrowserScreen({
  url = '',
  localPath,
  onWorkingCopyBound,
}: RepoBrowserScreenProps): JSX.Element {
  const [urlInput, setUrlInput] = useState(url);
  const [repoUrl, setRepoUrl] = useState(url);
  const [phase, setPhase] = useState<Phase>(url ? { kind: 'connecting' } : { kind: 'needs-url' });
  const [credentials, setCredentials] = useState<RepoBrowserCredentials | null>(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  const isValid = useMemo(() => isProbablyRepoUrl(urlInput), [urlInput]);

  const connect = useCallback(async (target: string, creds: RepoBrowserCredentials | null) => {
    setPhase({ kind: 'connecting' });
    try {
      const resolved =
        creds ?? (await loadRepoBrowserCredentials(target, window.api.auth)).credentials;
      setCredentials(resolved);
      // A cheap reachability probe: if the root lists, we can browse.
      const result = await window.api.svn.list(target, 'HEAD', 'immediates', resolved?.id);
      if (result.error) throw new Error(result.error);
      setRepoUrl(target);
      setPhase({ kind: 'connected' });
    } catch (error) {
      if (isRepoBrowserAuthError(error)) {
        const { realm } = await loadRepoBrowserCredentials(target, window.api.auth);
        setPhase({ kind: 'needs-auth', realm });
        return;
      }
      setPhase({
        kind: 'failed',
        message: (error as Error)?.message || 'Could not reach the repository.',
      });
    }
  }, []);

  // Connect automatically when the route already carries a URL.
  useEffect(() => {
    if (url && phase.kind === 'connecting') void connect(url, null);
    // Only on mount / when the route URL changes.
  }, [url, connect, phase.kind]);

  if (phase.kind === 'connected') {
    return (
      <RepoBrowserView
        rootUrl={repoUrl}
        localPath={localPath}
        onWorkingCopyBound={onWorkingCopyBound}
        onCheckout={() => undefined}
        onUpdate={() => undefined}
        onCommit={() => undefined}
      />
    );
  }

  return (
    <div className="flex h-full items-center justify-center bg-bg p-8">
      <div className="w-full max-w-lg rounded-xl border border-border bg-bg-secondary p-6 shadow-panel">
        <div className="mb-4 flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-lg border border-accent/30 bg-accent/10 text-accent">
            <FolderGit2 className="h-5 w-5" aria-hidden="true" />
          </span>
          <div>
            <h1 className="text-lg font-semibold tracking-tight text-text">Repository browser</h1>
            <p className="text-xs text-text-secondary">
              Browse any repository on the server, whether or not you have it checked out.
            </p>
          </div>
        </div>

        {phase.kind === 'needs-auth' ? (
          <form
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              void window.api.auth
                .beginSession({
                  realm: phase.realm,
                  username,
                  password,
                  persistence: 'session',
                })
                .then((session) => connect(urlInput.trim(), session));
            }}
          >
            <div className="flex items-center gap-2 rounded-lg border border-svn-modified/40 bg-svn-modified/10 px-3 py-2 text-xs text-text-secondary">
              <KeyRound className="h-4 w-4 flex-none text-svn-modified" aria-hidden="true" />
              <span>
                <span className="font-medium text-text">Authentication required</span> for{' '}
                <span className="font-mono">{phase.realm}</span>
              </span>
            </div>
            <label className="block text-xs font-medium text-text-secondary">
              Username
              <input
                className="mt-1 w-full rounded-lg border border-border bg-bg px-3 py-2 font-mono text-sm text-text focus:border-accent focus:outline-none"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                autoFocus
              />
            </label>
            <label className="block text-xs font-medium text-text-secondary">
              Password
              <input
                type="password"
                className="mt-1 w-full rounded-lg border border-border bg-bg px-3 py-2 font-mono text-sm text-text focus:border-accent focus:outline-none"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
            <button
              type="submit"
              disabled={!username}
              className="w-full rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              Authenticate
            </button>
          </form>
        ) : (
          <form
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              if (isValid) void connect(urlInput.trim(), credentials);
            }}
          >
            <label className="block text-xs font-medium text-text-secondary">
              Repository URL
              <input
                className="mt-1 w-full rounded-lg border border-border bg-bg px-3 py-2 font-mono text-sm text-text focus:border-accent focus:outline-none"
                placeholder="svn://svn.example.com/atlas"
                value={urlInput}
                onChange={(event) => setUrlInput(event.target.value)}
                spellCheck={false}
                autoFocus
              />
            </label>

            {phase.kind === 'failed' ? (
              <div className="flex items-start gap-2 rounded-lg border border-svn-conflict/40 bg-svn-conflict/10 px-3 py-2 text-xs text-text-secondary">
                <AlertCircle
                  className="mt-0.5 h-4 w-4 flex-none text-svn-conflict"
                  aria-hidden="true"
                />
                <span>
                  <span className="font-medium text-text">Connection failed.</span> {phase.message}
                </span>
              </div>
            ) : null}

            <button
              type="submit"
              disabled={!isValid || phase.kind === 'connecting'}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              {phase.kind === 'connecting' ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  Connecting…
                </>
              ) : (
                'Connect'
              )}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

export default RepoBrowserScreen;
