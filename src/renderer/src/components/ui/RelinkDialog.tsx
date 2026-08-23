/**
 * Relink flow for a working copy whose folder went missing (#60, renderer).
 *
 * When a status read fails because the checkout moved, the sidebar offers
 * "Relink working copy…": the user picks the new location, the dialog verifies
 * it is plausibly *the same* checkout (repository UUID, then URL, then
 * repository root) with `svn info`, and — on a weak match — requires an
 * explicit confirmation before touching anything.
 *
 * Applying prefers Track A's `svn:applyWcRelink` IPC, which rewrites the
 * monitor registry *and* `settings.recentRepositories` in the main process and
 * approves the new folder for IPC. A renderer-side settings rewrite remains as
 * the fallback for pre-IPC builds.
 *
 * The flow is manual but auto-detect ready: a detected location can arrive as
 * the {@link RelinkDialogProps.detectedPath} prop or as a
 * `shellysvn:relink-detected` window event (`{ oldPath, newPath }`), and the
 * "Search for moved folder" button calls `svn:detectWcRelinks` directly.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { FolderSearch, FolderOpen, Loader2, AlertTriangle, CheckCircle2, Info } from 'lucide-react';
import type { RelinkConfidence, RelinkMatchBasis, SvnInfoResult } from '@shared/types';

import { DialogBase } from './DialogBase';
import { keyTouchesPrefix, resetRepositoryQueries } from '@renderer/lib/queryKeys';
import { readCachedInfo } from '@renderer/utils/cachedSvnRead';
import { shortenPath } from '@renderer/components/sidebar/sidebarData';

export interface RelinkExpectedIdentity {
  /** Repository URL recorded for the working copy before it went missing. */
  url?: string;
  repositoryRoot?: string;
  repositoryUuid?: string;
}

interface RelinkDialogProps {
  isOpen: boolean;
  onClose: () => void;
  /** Stored (now missing) working-copy path. */
  oldPath: string;
  /** Last-known identity of that working copy, from the sidebar's cached info. */
  expected?: RelinkExpectedIdentity;
  /**
   * Detected new location (Track A's auto-detect signal). When provided the
   * dialog starts from it instead of a blank picker.
   */
  detectedPath?: string | null;
  /** Fired after the relink was applied and caches were reset. */
  onApplied?: (oldPath: string, newPath: string) => void;
}

type VerificationMatch = 'uuid' | 'url' | 'root' | 'none';

interface Verification {
  path: string;
  info: SvnInfoResult;
  match: VerificationMatch;
}

function matchBasis(match: VerificationMatch): { matchedOn: RelinkMatchBasis; confidence: RelinkConfidence } {
  if (match === 'uuid') return { matchedOn: 'uuid', confidence: 'high' };
  if (match === 'url') return { matchedOn: 'url', confidence: 'high' };
  if (match === 'root') return { matchedOn: 'url', confidence: 'medium' };
  return { matchedOn: 'basename', confidence: 'low' };
}

function verifyIdentity(info: SvnInfoResult, expected: RelinkExpectedIdentity): VerificationMatch {
  if (expected.repositoryUuid && info.repositoryUuid) {
    if (info.repositoryUuid === expected.repositoryUuid) {
      return info.url === expected.url ? 'uuid' : 'root';
    }
    // A different UUID is a different repository — never a quiet "root" match.
    return 'none';
  }
  if (expected.url && info.url === expected.url) return 'url';
  if (expected.repositoryRoot && info.repositoryRoot === expected.repositoryRoot) return 'root';
  return 'none';
}

function isNotAWorkingCopyError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return /not a working copy|E155007|ENOENT|does not exist|no such/i.test(message);
}

const MATCH_COPY: Record<VerificationMatch, { title: string; detail: string }> = {
  uuid: {
    title: 'Same working copy',
    detail: 'Repository UUID and URL match the recorded working copy.',
  },
  url: {
    title: 'Same checkout URL',
    detail: 'The folder points at the exact repository URL that was recorded.',
  },
  root: {
    title: 'Same repository, different directory',
    detail:
      'The folder belongs to the same repository but a different branch or directory. Relinking will point the app at this location.',
  },
  none: {
    title: 'Different repository',
    detail:
      'This folder does not look like the same working copy. Relinking anyway may mix a foreign checkout into your recent list.',
  },
};

export function RelinkDialog({
  isOpen,
  onClose,
  oldPath,
  expected = {},
  detectedPath = null,
  onApplied,
}: RelinkDialogProps) {
  const queryClient = useQueryClient();
  const [candidate, setCandidate] = useState<string | null>(null);
  const [verification, setVerification] = useState<Verification | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [isDetecting, setIsDetecting] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmMismatch, setConfirmMismatch] = useState(false);
  const [appliedTo, setAppliedTo] = useState<string | null>(null);
  // Expected identity may arrive as a prop; when it does not (the overview
  // read failed together with the folder), fall back to the offline cache's
  // last-known `svn info` for the missing path.
  const [cachedExpected, setCachedExpected] = useState<RelinkExpectedIdentity>({});

  const expectedIdentity: RelinkExpectedIdentity = useMemo(
    () => (expected.url || expected.repositoryUuid ? expected : cachedExpected),
    [expected, cachedExpected]
  );

  useEffect(() => {
    if (!isOpen || expected.url || expected.repositoryUuid) return;
    let cancelled = false;
    readCachedInfo(oldPath)
      .then((cached) => {
        const info = cached.data;
        if (cancelled || !info?.url) return;
        setCachedExpected({
          url: info.url,
          repositoryRoot: info.repositoryRoot,
          repositoryUuid: info.repositoryUuid,
        });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [isOpen, oldPath, expected.url, expected.repositoryUuid]);

  const hasApplyIpc = typeof window.api.svn?.applyWcRelink === 'function';
  const hasDetectIpc = typeof window.api.svn?.detectWcRelinks === 'function';

  const reset = useCallback(() => {
    setCandidate(null);
    setVerification(null);
    setIsVerifying(false);
    setIsDetecting(false);
    setIsApplying(false);
    setError(null);
    setConfirmMismatch(false);
    setAppliedTo(null);
  }, []);

  useEffect(() => {
    if (isOpen) reset();
  }, [isOpen, reset]);

  const verifyCandidate = useCallback(
    async (path: string) => {
      setIsVerifying(true);
      setError(null);
      setVerification(null);
      setConfirmMismatch(false);
      try {
        const info = await window.api.svn.info(path);
        if (!info?.url) throw new Error('svn info did not report a URL');
        setCandidate(path);
        setVerification({ path, info, match: verifyIdentity(info, expectedIdentity) });
      } catch (verifyError) {
        setCandidate(path);
        setVerification(null);
        setError(
          isNotAWorkingCopyError(verifyError)
            ? `${path} is not a Subversion working copy.`
            : verifyError instanceof Error
              ? verifyError.message
              : String(verifyError)
        );
      } finally {
        setIsVerifying(false);
      }
    },
    [expectedIdentity]
  );

  // A detected hint (prop or event) starts the flow already verified.
  useEffect(() => {
    if (!isOpen || !detectedPath || detectedPath === candidate) return;
    void verifyCandidate(detectedPath);
  }, [isOpen, detectedPath, candidate, verifyCandidate]);

  useEffect(() => {
    if (!isOpen) return;
    const handleDetected = (event: Event) => {
      const detail =
        event instanceof CustomEvent ? (event.detail as { oldPath?: string; newPath?: string }) : null;
      if (!detail?.newPath) return;
      if (detail.oldPath && detail.oldPath !== oldPath) return;
      void verifyCandidate(detail.newPath);
    };
    window.addEventListener('shellysvn:relink-detected', handleDetected);
    return () => window.removeEventListener('shellysvn:relink-detected', handleDetected);
  }, [isOpen, oldPath, verifyCandidate]);

  const chooseFolder = useCallback(async () => {
    setError(null);
    const chosen = await window.api.dialog.openDirectory(oldPath);
    if (!chosen || chosen === oldPath) return;
    await verifyCandidate(chosen);
  }, [oldPath, verifyCandidate]);

  const detectMovedFolder = useCallback(async () => {
    if (!hasDetectIpc) return;
    setIsDetecting(true);
    setError(null);
    try {
      const result = await window.api.svn.detectWcRelinks();
      const proposal = result.proposals.find((entry) => entry.oldPath === oldPath);
      if (!proposal) {
        setError('No likely new location was found. Pick the folder manually.');
        return;
      }
      await verifyCandidate(proposal.newPath);
    } catch (detectError) {
      setError(detectError instanceof Error ? detectError.message : String(detectError));
    } finally {
      setIsDetecting(false);
    }
  }, [hasDetectIpc, oldPath, verifyCandidate]);

  const weakMatch = verification ? verification.match === 'root' || verification.match === 'none' : false;
  const canApply =
    !!verification && !isApplying && (!weakMatch || confirmMismatch) && verification.path !== oldPath;

  const apply = useCallback(async () => {
    if (!verification || !canApply) return;
    setIsApplying(true);
    setError(null);
    try {
      if (hasApplyIpc) {
        const { matchedOn, confidence } = matchBasis(verification.match);
        const result = await window.api.svn.applyWcRelink({
          oldPath,
          newPath: verification.path,
          matchedOn,
          confidence,
          url: verification.info.url,
          repositoryUuid: verification.info.repositoryUuid,
        });
        if (!result.success) throw new Error(result.error ?? 'Relink failed');
      } else {
        // Fallback for builds without the IPC: rewrite the settings slice the
        // renderer persists, mirroring what applyWcRelink does in main.
        const settings = await window.api.store.get<Record<string, unknown>>('settings');
        const recents = Array.isArray(settings?.recentRepositories)
          ? (settings.recentRepositories as unknown[])
          : [];
        const next = recents.map((entry) => (entry === oldPath ? verification.path : entry));
        if (!next.includes(verification.path)) next.push(verification.path);
        await window.api.store.set('settings', { ...settings, recentRepositories: next });
      }

      // Cache reset (reuse of lib/queryKeys.ts helpers, read-only):
      //  - everything keyed by the old path is *removed* — the path is gone;
      //  - URL-keyed queries are only dropped when the URL actually changed;
      //  - settings + sidebar scopes are invalidated so the rail refetches.
      queryClient.removeQueries({
        predicate: ({ queryKey }) => keyTouchesPrefix(queryKey, oldPath),
      });
      if (expectedIdentity.url && verification.info.url !== expectedIdentity.url) {
        resetRepositoryQueries(queryClient, { previousRepoUrl: expectedIdentity.url });
      }
      resetRepositoryQueries(queryClient, { workingCopyPath: verification.path });
      await queryClient.invalidateQueries({ queryKey: ['settings'] });
      await queryClient.invalidateQueries({ queryKey: ['sidebar:overview'] });
      await queryClient.invalidateQueries({ queryKey: ['sidebar:info'] });

      setAppliedTo(verification.path);
      onApplied?.(oldPath, verification.path);
    } catch (applyError) {
      setError(applyError instanceof Error ? applyError.message : String(applyError));
    } finally {
      setIsApplying(false);
    }
  }, [
    canApply,
    expectedIdentity.url,
    hasApplyIpc,
    oldPath,
    onApplied,
    queryClient,
    verification,
  ]);

  const matchCopy = verification ? MATCH_COPY[verification.match] : null;
  const basename = useMemo(() => oldPath.split('/').filter(Boolean).pop() ?? oldPath, [oldPath]);

  return (
    <DialogBase
      isOpen={isOpen}
      onClose={onClose}
      title="Relink working copy"
      dialogId="relink-working-copy"
      className="w-[540px]"
      ariaDescribedBy="relink-dialog-description"
    >
      <div className="modal-body space-y-4">
        <p id="relink-dialog-description" className="text-sm text-text-secondary">
          <span className="font-mono text-12 text-text">{shortenPath(oldPath, 3)}</span> can no
          longer be found. Choose where <strong>{basename}</strong> lives now — the app verifies
          the folder is the same checkout before relinking.
        </p>

        {appliedTo ? (
          <div
            className="flex items-start gap-2.5 rounded-lg border border-svn-normal/40 bg-svn-normal/10 p-3"
            role="status"
            data-testid="relink-applied"
          >
            <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-svn-normal" aria-hidden="true" />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-text">Relinked</p>
              <p className="break-all font-mono text-11 text-text-muted">{appliedTo}</p>
            </div>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn btn-secondary btn-sm gap-1.5" onClick={() => void chooseFolder()}>
                <FolderOpen className="h-3.5 w-3.5" aria-hidden="true" />
                Choose folder…
              </button>
              {hasDetectIpc && (
                <button
                  type="button"
                  className="btn btn-secondary btn-sm gap-1.5"
                  onClick={() => void detectMovedFolder()}
                  disabled={isDetecting || isVerifying}
                >
                  {isDetecting ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                  ) : (
                    <FolderSearch className="h-3.5 w-3.5" aria-hidden="true" />
                  )}
                  Search for moved folder
                </button>
              )}
            </div>

            {candidate && !verification && !isVerifying && (
              <p className="break-all font-mono text-11 text-text-muted" data-testid="relink-candidate">
                {candidate}
              </p>
            )}
            {isVerifying && (
              <p className="flex items-center gap-2 text-sm text-text-muted" role="status">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Verifying…
              </p>
            )}

            {verification && matchCopy && (
              <div
                className={`space-y-1.5 rounded-lg border p-3 ${
                  verification.match === 'uuid' || verification.match === 'url'
                    ? 'border-svn-normal/40 bg-svn-normal/10'
                    : verification.match === 'root'
                      ? 'border-warning/40 bg-warning/10'
                      : 'border-svn-conflict/40 bg-svn-conflict/10'
                }`}
                data-testid="relink-verification"
              >
                <p className="flex items-center gap-1.5 text-sm font-semibold text-text">
                  {verification.match === 'uuid' || verification.match === 'url' ? (
                    <CheckCircle2 className="h-4 w-4 text-svn-normal" aria-hidden="true" />
                  ) : (
                    <AlertTriangle className="h-4 w-4 text-warning" aria-hidden="true" />
                  )}
                  {matchCopy.title}
                </p>
                <p className="text-12.5 leading-relaxed text-text-secondary">{matchCopy.detail}</p>
                <dl className="space-y-0.5 pt-1 font-mono text-10.5 text-text-muted">
                  <div className="flex gap-2">
                    <dt className="w-16 flex-shrink-0">URL</dt>
                    <dd className="break-all">{verification.info.url}</dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="w-16 flex-shrink-0">UUID</dt>
                    <dd className="break-all">{verification.info.repositoryUuid || '—'}</dd>
                  </div>
                  {expectedIdentity.url && expectedIdentity.url !== verification.info.url && (
                    <div className="flex gap-2">
                      <dt className="w-16 flex-shrink-0">was</dt>
                      <dd className="break-all">{expectedIdentity.url}</dd>
                    </div>
                  )}
                </dl>
                {weakMatch && (
                  <label className="flex items-start gap-2 pt-1.5 text-12.5 text-text-secondary">
                    <input
                      type="checkbox"
                      checked={confirmMismatch}
                      onChange={(e) => setConfirmMismatch(e.target.checked)}
                      className="mt-0.5 h-3.5 w-3.5 accent-[var(--color-accent)]"
                      data-testid="relink-confirm-mismatch"
                    />
                    <span>
                      I understand this folder {verification.match === 'none' ? 'is a different repository' : 'points at a different directory'} and want to relink to it anyway.
                    </span>
                  </label>
                )}
              </div>
            )}

            {error && (
              <p
                className="flex items-start gap-2 rounded-lg border border-svn-conflict/40 bg-svn-conflict/10 p-2.5 text-12.5 text-text-secondary"
                role="alert"
                data-testid="relink-error"
              >
                <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-svn-conflict" aria-hidden="true" />
                {error}
              </p>
            )}

            {!hasApplyIpc && (
              <p className="flex items-start gap-2 text-11 text-text-faint">
                <Info className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
                Applying will update this app&apos;s stored working-copy path directly (the
                <span className="font-mono">svn:applyWcRelink</span> IPC is not available in this
                build).
              </p>
            )}
          </>
        )}
      </div>

      <div className="modal-footer">
        <button type="button" className="btn btn-secondary" onClick={onClose}>
          {appliedTo ? 'Close' : 'Cancel'}
        </button>
        {!appliedTo && (
          <button
            type="button"
            className="btn btn-primary gap-1.5"
            onClick={() => void apply()}
            disabled={!canApply}
            data-testid="relink-apply"
          >
            {isApplying && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
            Relink working copy
          </button>
        )}
      </div>
    </DialogBase>
  );
}

export default RelinkDialog;
