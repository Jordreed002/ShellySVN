import { useState } from 'react';
import { Check, ChevronDown, GitBranch, GitBranchPlus, Loader2, Plus, Tag } from 'lucide-react';

import { mapSubPathToBranch, resolveBranchContext, type BranchKind } from './branchDetection';
import { useBranchList, useInvalidateBranches } from './useBranches';

interface BranchSwitcherProps {
  /** Repo URL of the current location. */
  url?: string;
  /** Local working-copy path to switch. */
  localPath: string;
  onSwitched?: () => void;
  onCreateBranch?: () => void;
  onCreateTag?: () => void;
}

function BranchOption({
  icon: Icon,
  label,
  current,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  current: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={current}
      onClick={onClick}
      className={`dropdown-item w-full justify-between ${current ? 'text-accent' : ''}`}
    >
      <span className="flex items-center gap-2 min-w-0">
        <Icon className="w-4 h-4 flex-shrink-0" />
        <span className="truncate">{label}</span>
      </span>
      {current && <Check className="w-4 h-4 flex-shrink-0" />}
    </button>
  );
}

/**
 * Per-path branch chip + scoped switcher. Resolves the nearest branch-root for
 * the current URL, shows the current branch, and lets you switch to any
 * trunk/branch/tag under that root (scoped to the current sub-path) or create a
 * new branch/tag. Backed by the lazy branch cache.
 */
export function BranchSwitcher({
  url,
  localPath,
  onSwitched,
  onCreateBranch,
  onCreateTag,
}: BranchSwitcherProps) {
  const ctx = resolveBranchContext(url);
  const { data: list, isFetching } = useBranchList(ctx?.branchRootUrl ?? null);
  const invalidate = useInvalidateBranches();
  const [open, setOpen] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [switchError, setSwitchError] = useState<string | null>(null);

  if (!ctx) return null;

  const ChipIcon = ctx.branchKind === 'tag' ? Tag : GitBranch;
  const isCurrent = (name: string, kind: BranchKind) =>
    ctx.branch === name && ctx.branchKind === kind;

  const doSwitch = async (targetBranchUrl: string) => {
    if (switching) return;
    setOpen(false);
    setSwitching(true);
    setSwitchError(null);
    try {
      const target = mapSubPathToBranch(targetBranchUrl, ctx.subPath);
      const result = await window.api.svn.switch(localPath, target);
      if (result.success) {
        invalidate(ctx.branchRootUrl);
        onSwitched?.();
      } else {
        setSwitchError('SVN could not switch this working copy.');
      }
    } catch (error) {
      setSwitchError(
        error instanceof Error ? error.message : 'SVN could not switch this working copy.'
      );
    } finally {
      setSwitching(false);
    }
  };

  return (
    <div className="relative titlebar-no-drag">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-bg-elevated text-xs text-text-secondary hover:text-text transition-fast"
        title="Switch branch"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <ChipIcon className="w-3.5 h-3.5 text-accent flex-shrink-0" />
        <span className="max-w-[160px] truncate font-medium">{ctx.branch}</span>
        {switching ? (
          <Loader2 className="w-3 h-3 animate-spin" />
        ) : (
          <ChevronDown className="w-3 h-3" />
        )}
      </button>
      {switchError && (
        <div
          role="alert"
          className="absolute left-0 top-full z-50 mt-1 w-72 rounded-md border border-danger/30 bg-bg-elevated px-3 py-2 text-xs text-danger shadow-lg"
        >
          Branch switch failed: {switchError}
        </div>
      )}

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} aria-hidden="true" />
          <div
            className="dropdown left-0 z-50 w-64 max-h-[60vh] overflow-y-auto scrollbar-overlay"
            role="menu"
            aria-label="Switch branch"
            onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}
          >
            <div className="px-3 py-1.5 text-2xs font-semibold uppercase tracking-wide text-text-muted">
              {isFetching && !list ? 'Loading branches…' : 'Switch branch'}
            </div>

            {list?.trunkUrl && (
              <BranchOption
                icon={GitBranch}
                label="trunk"
                current={isCurrent('trunk', 'trunk')}
                onClick={() => doSwitch(list.trunkUrl)}
              />
            )}

            {list && list.branches.length > 0 && (
              <div className="px-3 pt-2 pb-1 text-2xs font-semibold uppercase tracking-wide text-text-faint">
                Branches
              </div>
            )}
            {list?.branches.map((b) => (
              <BranchOption
                key={b.url}
                icon={GitBranch}
                label={b.name}
                current={isCurrent(b.name, 'branch')}
                onClick={() => doSwitch(b.url)}
              />
            ))}

            {list && list.tags.length > 0 && (
              <div className="px-3 pt-2 pb-1 text-2xs font-semibold uppercase tracking-wide text-text-faint">
                Tags
              </div>
            )}
            {list?.tags.map((t) => (
              <BranchOption
                key={t.url}
                icon={Tag}
                label={t.name}
                current={isCurrent(t.name, 'tag')}
                onClick={() => doSwitch(t.url)}
              />
            ))}

            {(onCreateBranch || onCreateTag) && <div className="context-menu-divider" />}
            {onCreateBranch && (
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  onCreateBranch();
                }}
                className="dropdown-item w-full"
              >
                <GitBranchPlus className="w-4 h-4" />
                Create branch…
              </button>
            )}
            {onCreateTag && (
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  onCreateTag();
                }}
                className="dropdown-item w-full"
              >
                <Plus className="w-4 h-4" />
                Create tag…
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
