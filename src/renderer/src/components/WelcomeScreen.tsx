import { lazy, Suspense, useState, useCallback } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useSettings } from '@renderer/hooks/useSettings';
import {
  FolderOpen,
  GitBranch,
  Clock,
  ChevronRight,
  Upload,
  Download,
  RefreshCw,
  FileEdit,
  Turtle,
} from 'lucide-react';

import { m, useMotionEnabled, variants } from '../lib/motion';
import { ShellMark } from './ShellMark';

const AddRepoModal = lazy(() =>
  import('./ui/AddRepoModal').then((mod) => ({ default: mod.AddRepoModal }))
);
const ImportDialog = lazy(() =>
  import('./ui/ImportDialog').then((mod) => ({ default: mod.ImportDialog }))
);

export function WelcomeScreen() {
  const navigate = useNavigate();
  const { settings, addRecentRepo } = useSettings();
  const [isAddRepoModalOpen, setIsAddRepoModalOpen] = useState(false);
  const [addRepoModalTab, setAddRepoModalTab] = useState<'open' | 'checkout' | 'import'>('open');
  const [isDragOver, setIsDragOver] = useState(false);
  const [isImportDialogOpen, setIsImportDialogOpen] = useState(false);

  const handleOpenWorkingCopy = useCallback(
    async (path: string) => {
      // Save to recent repos
      await addRecentRepo(path);
      // Navigate to the file explorer
      navigate({ to: '/files', search: { path } });
    },
    [navigate, addRecentRepo]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);

      const items = e.dataTransfer.items;
      for (const item of items) {
        if (item.kind === 'file') {
          const entry = item.webkitGetAsEntry?.();
          if (entry?.isDirectory) {
            const path = (entry as FileSystemDirectoryEntry).fullPath;
            // Try to verify it's a working copy
            try {
              await window.api.svn.info(path);
              handleOpenWorkingCopy(path);
            } catch {
              console.log('Not a valid SVN working copy');
            }
          }
        }
      }
    },
    [handleOpenWorkingCopy]
  );

  const openModal = (tab: 'open' | 'checkout' | 'import') => {
    setAddRepoModalTab(tab);
    setIsAddRepoModalOpen(true);
  };

  const recentRepos = settings?.recentRepositories || [];
  const motionEnabled = useMotionEnabled();
  const initial = motionEnabled ? 'initial' : false;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Main Content */}
      <div className="flex-1 flex items-center justify-center p-8 overflow-y-auto scrollbar-overlay">
        <m.div
          className="w-full max-w-2xl space-y-8"
          variants={variants.staggerList}
          initial={initial}
          animate="animate"
        >
          {/* Logo & Title */}
          <m.div className="text-center space-y-4" variants={variants.listItem}>
            <div className="flex justify-center">
              <m.div
                className="relative"
                initial={initial}
                animate={motionEnabled ? { scale: [0.9, 1], opacity: [0, 1] } : undefined}
                transition={{ duration: 0.5, ease: [0.25, 1, 0.5, 1] }}
              >
                <div className="absolute inset-0 blur-3xl bg-accent/25 rounded-full" />
                <ShellMark className="w-24 h-24 text-accent relative drop-shadow-[0_4px_24px_var(--color-accent-glow)]" />
              </m.div>
            </div>
            <div>
              <h1 className="text-4xl font-bold text-text tracking-tight">ShellySVN</h1>
              <p className="text-text-secondary mt-2">
                A modern Subversion client — press{' '}
                <span className="kbd align-middle">⌘K</span> to get started
              </p>
            </div>
          </m.div>

          {/* Drop Zone */}
          <m.div variants={variants.listItem}>
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              className={`
                drop-zone cursor-pointer transition-all duration-300
                ${isDragOver ? 'drop-zone-active scale-[1.02]' : 'hover:border-accent/40 hover:bg-bg-secondary/40'}
              `}
              onClick={() => openModal('open')}
            >
              <div className="flex flex-col items-center gap-3">
                <div
                  className={`
                  w-16 h-16 rounded-2xl bg-bg-tertiary flex items-center justify-center
                  transition-all duration-300
                  ${isDragOver ? 'bg-accent/20 scale-110' : ''}
                `}
                >
                  <FolderOpen
                    className={`w-8 h-8 transition-colors ${isDragOver ? 'text-accent' : 'text-text-muted'}`}
                  />
                </div>
                <div>
                  <p className="text-lg font-semibold text-text">
                    {isDragOver ? 'Drop to Open' : 'Open Working Copy'}
                  </p>
                  <p className="text-sm text-text-secondary mt-1">
                    Drag a folder here or click to browse
                  </p>
                </div>
              </div>
            </div>
          </m.div>

          {/* Quick Actions */}
          <m.div className="flex justify-center gap-3" variants={variants.listItem}>
            <button
              onClick={() => openModal('open')}
              className="btn btn-secondary gap-2"
              data-testid="browse-button"
            >
              <FolderOpen className="w-4 h-4" />
              Browse
            </button>
            <button
              onClick={() => openModal('checkout')}
              className="btn btn-primary gap-2"
              data-testid="checkout-button"
            >
              <GitBranch className="w-4 h-4" />
              Checkout
            </button>
          </m.div>

          {/* Recent Repositories */}
          {recentRepos.length > 0 && (
            <m.div className="space-y-3" variants={variants.listItem}>
              <div className="flex items-center gap-2 text-sm text-text-secondary">
                <Clock className="w-4 h-4" />
                <span>Recent Repositories</span>
              </div>
              <div className="grid gap-2">
                {recentRepos.slice(0, 5).map((repo) => {
                  const name = repo.split('/').pop() || repo;
                  return (
                    <m.button
                      key={repo}
                      onClick={() => handleOpenWorkingCopy(repo)}
                      whileHover={motionEnabled ? { x: 3 } : undefined}
                      className="flex items-center gap-3 px-4 py-3 card hover:border-accent/50 hover:bg-bg-tertiary transition-colors group text-left"
                    >
                      <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center flex-shrink-0">
                        <FolderOpen className="w-5 h-5 text-accent" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-text truncate">{name}</p>
                        <p className="text-xs text-text-muted truncate">{repo}</p>
                      </div>
                      <ChevronRight className="w-5 h-5 text-text-faint opacity-0 group-hover:opacity-100 transition-opacity" />
                    </m.button>
                  );
                })}
              </div>
            </m.div>
          )}
        </m.div>
      </div>

      {/* Feature Highlights */}
      <div className="border-t border-border bg-bg-secondary/50">
        <div className="max-w-4xl mx-auto px-8 py-6">
          <div className="grid grid-cols-4 gap-6">
            <FeatureItem icon={Download} title="Update" description="Get latest changes" />
            <FeatureItem icon={Upload} title="Commit" description="Push your changes" />
            <FeatureItem icon={RefreshCw} title="Revert" description="Discard local edits" />
            <FeatureItem icon={FileEdit} title="Diff" description="Compare revisions" />
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="border-t border-border px-8 py-3 flex items-center justify-between text-xs text-text-muted">
        <div className="flex items-center gap-2">
          <Turtle className="w-3.5 h-3.5" />
          <span>ShellySVN bundles Subversion 1.14.x</span>
        </div>
        <span>No external dependencies required</span>
      </div>

      {/* Unified Modal */}
      {isAddRepoModalOpen && (
        <Suspense fallback={null}>
          <AddRepoModal
            isOpen={isAddRepoModalOpen}
            onClose={() => setIsAddRepoModalOpen(false)}
            onOpenRepo={handleOpenWorkingCopy}
            onImport={() => {
              setIsAddRepoModalOpen(false);
              setIsImportDialogOpen(true);
            }}
            recentRepos={recentRepos}
            initialTab={addRepoModalTab}
          />
        </Suspense>
      )}

      {/* Import Dialog */}
      {isImportDialogOpen && (
        <Suspense fallback={null}>
          <ImportDialog isOpen={isImportDialogOpen} onClose={() => setIsImportDialogOpen(false)} />
        </Suspense>
      )}
    </div>
  );
}

function FeatureItem({
  icon: Icon,
  title,
  description,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="w-8 h-8 rounded-lg bg-bg-tertiary flex items-center justify-center flex-shrink-0">
        <Icon className="w-4 h-4 text-text-secondary" />
      </div>
      <div>
        <p className="text-sm font-medium text-text">{title}</p>
        <p className="text-xs text-text-muted">{description}</p>
      </div>
    </div>
  );
}
