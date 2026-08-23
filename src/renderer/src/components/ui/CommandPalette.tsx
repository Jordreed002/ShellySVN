import { useState, useEffect, useMemo, useCallback, useRef, useDeferredValue } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { m, springs, variants } from '../../lib/motion';
import {
  Search,
  CornerDownLeft,
  Folder,
  Settings,
  Upload,
  Download,
  Undo2,
  History,
  RefreshCw,
  Layers,
  StickyNote,
  Keyboard,
  Eye,
  Columns2,
  Zap,
  Star,
  StarOff,
  GitBranch,
  ArrowRightLeft,
  GitMerge,
  MapPin,
  User,
  ListChecks,
  Archive,
  ArchiveRestore,
  Bell,
  Puzzle,
  Lock,
  LockOpen,
  Globe,
  GitCompare,
  FileInput,
  FileOutput,
  Network,
  Plus,
  Trash2,
  Wrench,
  CheckCircle2,
  HelpCircle,
  Move,
  Copy,
  Pencil,
  Home,
  FolderOpen,
  BrainCircuit,
  KeyRound,
  Sun,
  Minus,
  Square,
  X,
} from 'lucide-react';
import { rankCommands } from '../../lib/commandPaletteFuzzy';
import { loadPaletteUsage, recordPaletteUsage, savePaletteUsage } from '../../lib/commandPaletteUsage';

interface CommandItem {
  id: string;
  title: string;
  description?: string;
  /**
   * The `svn` command this entry runs, shown as a mono line under the title —
   * the same idiom as the context menu. Absent for app navigation and view
   * toggles, which run no Subversion command.
   */
  command?: string;
  icon: React.ComponentType<{ className?: string }>;
  shortcut?: string;
  category: string;
  action: () => void;
  keywords?: string[];
}

/** Shell destinations the palette can navigate to (mirrors the sidebar rail). */
export type PaletteRoute = 'home' | 'files' | 'repo-browser' | 'history';

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  currentPath?: string;
  // Action callbacks
  onCommit?: () => void;
  onUpdate?: () => void;
  onRevert?: () => void;
  onAdd?: () => void;
  onDelete?: () => void;
  onCleanup?: () => void;
  onResolve?: () => void;
  onMove?: () => void;
  onCopy?: () => void;
  onRename?: () => void;
  onShowLog?: () => void;
  onRefresh?: () => void;
  onOpenSettings?: () => void;
  onTogglePreview?: () => void;
  onToggleDualPane?: () => void;
  onToggleFilters?: () => void;
  onShowShortcuts?: () => void;
  onShowNotes?: () => void;
  onQuickCommit?: () => void;
  onAddBookmark?: () => void;
  onGoToPath?: (path: string) => void;
  // New SVN operations callbacks
  onBranchTag?: () => void;
  onTag?: () => void;
  onBranchTagCompare?: () => void;
  onSwitch?: () => void;
  onMerge?: () => void;
  onRelocate?: () => void;
  onBlame?: () => void;
  onProperties?: () => void;
  onChangelist?: () => void;
  onShelve?: () => void;
  onUnshelve?: () => void;
  // Additional SVN operations
  onLock?: () => void;
  onUnlock?: () => void;
  onExport?: () => void;
  onImport?: () => void;
  onRepoBrowser?: () => void;
  onRevisionGraph?: () => void;
  onCreatePatch?: () => void;
  onApplyPatch?: () => void;
  // Plugin management
  onManagePlugins?: () => void;
  // Shell navigation (sidebar rail destinations)
  onGoToRoute?: (route: PaletteRoute) => void;
  // Shell surfaces reached through the palette
  onOpenAiReviewCenter?: () => void;
  onManageCredentials?: () => void;
  onToggleTheme?: () => void;
  // Help: the status-overlay legend (#94)
  onShowStatusLegend?: () => void;
  // Shell surfaces opened through lib/shellActions (#49/#64/#81)
  onOpenDiffWizard?: () => void;
  onOpenShelfManager?: () => void;
  onOpenNotificationCenter?: () => void;
  // Window controls (titlebar buttons)
  onMinimizeWindow?: () => void;
  onMaximizeWindow?: () => void;
  onCloseWindow?: () => void;
  // Recent paths
  recentPaths?: string[];
  // Bookmarks
  bookmarks?: { path: string; name: string }[];
}

export function CommandPalette({
  isOpen,
  onClose,
  currentPath,
  onCommit,
  onUpdate,
  onRevert,
  onAdd,
  onDelete,
  onCleanup,
  onResolve,
  onMove,
  onCopy,
  onRename,
  onShowLog,
  onRefresh,
  onOpenSettings,
  onTogglePreview,
  onToggleDualPane,
  onToggleFilters,
  onShowShortcuts,
  onShowNotes,
  onQuickCommit,
  onAddBookmark,
  onGoToPath,
  onBranchTag,
  onTag,
  onBranchTagCompare,
  onSwitch,
  onMerge,
  onRelocate,
  onBlame,
  onProperties,
  onChangelist,
  onShelve,
  onUnshelve,
  onLock,
  onUnlock,
  onExport,
  onImport,
  onRepoBrowser,
  onRevisionGraph,
  onCreatePatch,
  onApplyPatch,
  onManagePlugins,
  onGoToRoute,
  onOpenAiReviewCenter,
  onManageCredentials,
  onToggleTheme,
  onShowStatusLegend,
  onOpenDiffWizard,
  onOpenShelfManager,
  onOpenNotificationCenter,
  onMinimizeWindow,
  onMaximizeWindow,
  onCloseWindow,
  recentPaths = [],
  bookmarks = [],
}: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Build commands list
  const commands = useMemo<CommandItem[]>(() => {
    const items: CommandItem[] = [];

    // SVN Actions
    if (onCommit) {
      items.push({
        id: 'commit',
        command: 'svn commit',
        title: 'Commit changes',
        description: 'Commit selected files',
        icon: Upload,
        shortcut: 'Ctrl+S',
        category: 'SVN',
        action: onCommit,
        keywords: ['svn', 'checkin', 'save'],
      });
    }

    if (onUpdate) {
      items.push({
        id: 'update',
        command: 'svn update',
        title: 'Update working copy',
        description: 'Get latest changes from repository',
        icon: Download,
        shortcut: 'Ctrl+U',
        category: 'SVN',
        action: onUpdate,
        keywords: ['svn', 'checkout', 'pull'],
      });
    }

    if (onRevert) {
      items.push({
        id: 'revert',
        command: 'svn revert',
        title: 'Revert changes',
        description: 'Discard local modifications',
        icon: Undo2,
        shortcut: 'Ctrl+R',
        category: 'SVN',
        action: onRevert,
        keywords: ['svn', 'undo', 'discard'],
      });
    }

    if (onAdd) {
      items.push({
        id: 'add',
        command: 'svn add',
        title: 'Add to version control',
        description: 'Schedule selected files for addition',
        icon: Plus,
        category: 'SVN',
        action: onAdd,
        keywords: ['svn', 'add', 'version'],
      });
    }

    if (onDelete) {
      items.push({
        id: 'delete',
        command: 'svn delete',
        title: 'Delete selected',
        description: 'Delete or schedule selected files for deletion',
        icon: Trash2,
        category: 'SVN',
        action: onDelete,
        keywords: ['svn', 'delete', 'remove'],
      });
    }

    if (onCleanup) {
      items.push({
        id: 'cleanup',
        command: 'svn cleanup',
        title: 'Clean up working copy',
        description: 'Run SVN cleanup on the selected directory',
        icon: Wrench,
        category: 'SVN',
        action: onCleanup,
        keywords: ['svn', 'cleanup', 'lock'],
      });
    }

    if (onResolve) {
      items.push({
        id: 'resolve',
        command: 'svn resolve',
        title: 'Resolve conflict',
        description: 'Open conflict resolution for the selected item',
        icon: CheckCircle2,
        category: 'SVN',
        action: onResolve,
        keywords: ['svn', 'resolve', 'conflict'],
      });
    }

    if (onMove) {
      items.push({
        id: 'move',
        command: 'svn move',
        title: 'Move…',
        description: 'Move selected item while preserving history',
        icon: Move,
        category: 'SVN',
        action: onMove,
        keywords: ['svn', 'move'],
      });
    }

    if (onCopy) {
      items.push({
        id: 'copy',
        command: 'svn copy',
        title: 'Copy…',
        description: 'Copy selected item while preserving history',
        icon: Copy,
        category: 'SVN',
        action: onCopy,
        keywords: ['svn', 'copy'],
      });
    }

    if (onRename) {
      items.push({
        id: 'rename',
        command: 'svn move',
        title: 'Rename…',
        description: 'Rename selected item while preserving history',
        icon: Pencil,
        category: 'SVN',
        action: onRename,
        keywords: ['svn', 'rename'],
      });
    }

    if (onShowLog) {
      items.push({
        id: 'log',
        command: 'svn log -v',
        title: 'Show log',
        description: 'View revision history',
        icon: History,
        shortcut: 'Ctrl+L',
        category: 'SVN',
        action: onShowLog,
        keywords: ['svn', 'history', 'revisions'],
      });
    }

    if (onQuickCommit) {
      items.push({
        id: 'quick-commit',
        command: 'svn commit',
        title: 'Quick commit',
        description: 'Commit with auto-generated message',
        icon: Zap,
        category: 'SVN',
        action: onQuickCommit,
        keywords: ['fast', 'auto', 'quick'],
      });
    }

    if (onBranchTag) {
      items.push({
        id: 'branch-tag',
        command: 'svn copy',
        title: 'Create branch…',
        description: 'Create a branch in repository',
        icon: GitBranch,
        shortcut: 'Ctrl+Shift+B',
        category: 'SVN',
        action: onBranchTag,
        keywords: ['branch'],
      });
    }

    if (onTag) {
      items.push({
        id: 'tag',
        command: 'svn copy',
        title: 'Create tag…',
        description: 'Create a tag in repository',
        icon: GitBranch,
        category: 'SVN',
        action: onTag,
        keywords: ['tag', 'release'],
      });
    }

    if (onBranchTagCompare) {
      items.push({
        id: 'branch-tag-compare',
        command: 'svn diff --old --new',
        title: 'Compare branches or tags…',
        description: 'Compare two repository URLs',
        icon: GitCompare,
        category: 'SVN',
        action: onBranchTagCompare,
        keywords: ['branch', 'tag', 'compare', 'diff'],
      });
    }

    // #49: arbitrary revision-to-revision / URL-to-URL diff wizard.
    if (onOpenDiffWizard) {
      items.push({
        id: 'diff-wizard',
        title: 'Diff wizard…',
        description: 'Diff any two revisions or URLs, with saved comparisons',
        icon: GitCompare,
        category: 'SVN',
        action: onOpenDiffWizard,
        keywords: ['diff', 'wizard', 'compare', 'revision', 'url', 'changes'],
      });
    }

    if (onSwitch) {
      items.push({
        id: 'switch',
        command: 'svn switch',
        title: 'Switch…',
        description: 'Switch to a different branch or URL',
        icon: ArrowRightLeft,
        shortcut: 'Ctrl+Shift+S',
        category: 'SVN',
        action: onSwitch,
        keywords: ['switch'],
      });
    }

    if (onMerge) {
      items.push({
        id: 'merge',
        command: 'svn merge',
        title: 'Merge…',
        description: 'Merge changes from another location',
        icon: GitMerge,
        shortcut: 'Ctrl+Shift+M',
        category: 'SVN',
        action: onMerge,
        keywords: ['merge'],
      });
    }

    if (onRelocate) {
      items.push({
        id: 'relocate',
        command: 'svn relocate',
        title: 'Relocate…',
        description: 'Change repository URL of working copy',
        icon: MapPin,
        shortcut: 'Ctrl+Shift+R',
        category: 'SVN',
        action: onRelocate,
        keywords: ['relocate'],
      });
    }

    if (onBlame) {
      items.push({
        id: 'blame',
        command: 'svn blame',
        title: 'Blame',
        description: 'Show file revision history',
        icon: User,
        category: 'SVN',
        action: onBlame,
        keywords: ['blame', 'annotate'],
      });
    }

    if (onProperties) {
      items.push({
        id: 'properties',
        command: 'svn proplist -v',
        title: 'Properties…',
        description: 'Edit file or directory properties',
        icon: Settings,
        category: 'SVN',
        action: onProperties,
        keywords: ['properties', 'props'],
      });
    }

    if (onChangelist) {
      items.push({
        id: 'changelist',
        command: 'svn changelist',
        title: 'Changelist…',
        description: 'Manage changelists for changes',
        icon: ListChecks,
        category: 'SVN',
        action: onChangelist,
        keywords: ['changelist'],
      });
    }

    if (onShelve) {
      items.push({
        id: 'shelve',
        command: 'svn shelf-save',
        title: 'Shelve changes…',
        description: 'Temporarily store changes locally',
        icon: Archive,
        category: 'SVN',
        action: onShelve,
        keywords: ['shelve', 'archive'],
      });
    }

    if (onUnshelve) {
      items.push({
        id: 'unshelve',
        command: 'svn shelf-apply',
        title: 'Unshelve changes…',
        description: 'Restore previously shelved changes',
        icon: ArchiveRestore,
        category: 'SVN',
        action: onUnshelve,
        keywords: ['unshelve', 'restore'],
      });
    }

    // #64: shelf manager — rename/diff/expiry/portable shelves.
    if (onOpenShelfManager) {
      items.push({
        id: 'shelf-manager',
        title: 'Shelf manager…',
        description: 'Manage shelves: apply, delete, expiry, portable import/export',
        icon: Archive,
        category: 'SVN',
        action: onOpenShelfManager,
        keywords: ['shelf', 'shelve', 'manager', 'expiry', 'portable'],
      });
    }

    if (onLock) {
      items.push({
        id: 'lock',
        command: 'svn lock',
        title: 'Lock…',
        description: 'Lock selected files in repository',
        icon: Lock,
        category: 'SVN',
        action: onLock,
        keywords: ['lock'],
      });
    }

    if (onUnlock) {
      items.push({
        id: 'unlock',
        command: 'svn unlock',
        title: 'Unlock…',
        description: 'Release lock on selected files',
        icon: LockOpen,
        category: 'SVN',
        action: onUnlock,
        keywords: ['unlock'],
      });
    }

    if (onExport) {
      items.push({
        id: 'export',
        command: 'svn export',
        title: 'Export…',
        description: 'Export directory or files from working copy',
        icon: FileOutput,
        category: 'SVN',
        action: onExport,
        keywords: ['export'],
      });
    }

    if (onImport) {
      items.push({
        id: 'import',
        command: 'svn import',
        title: 'Import…',
        description: 'Import files to repository',
        icon: FileInput,
        category: 'SVN',
        action: onImport,
        keywords: ['import'],
      });
    }

    if (onRepoBrowser) {
      items.push({
        id: 'repo-browser',
        title: 'Repository browser',
        description: 'Browse repository structure',
        icon: Globe,
        category: 'SVN',
        action: onRepoBrowser,
        keywords: ['repo', 'browser', 'repository'],
      });
    }

    if (onRevisionGraph) {
      items.push({
        id: 'revision-graph',
        title: 'Revision graph',
        description: 'Show revision history graph',
        icon: Network,
        category: 'SVN',
        action: onRevisionGraph,
        keywords: ['revision', 'graph', 'history'],
      });
    }

    if (onCreatePatch) {
      items.push({
        id: 'create-patch',
        command: 'svn diff',
        title: 'Create patch…',
        description: 'Create a patch file from changes',
        icon: GitCompare,
        category: 'SVN',
        action: onCreatePatch,
        keywords: ['patch', 'diff', 'create'],
      });
    }

    if (onApplyPatch) {
      items.push({
        id: 'apply-patch',
        command: 'svn patch',
        title: 'Apply patch…',
        description: 'Apply a patch file to working copy',
        icon: GitCompare,
        category: 'SVN',
        action: onApplyPatch,
        keywords: ['patch', 'apply'],
      });
    }

    // Navigation — the sidebar rail's destinations
    if (onGoToRoute) {
      items.push(
        {
          id: 'go-home',
          title: 'Go to Home',
          description: 'Open the home briefing screen',
          icon: Home,
          category: 'Navigation',
          action: () => onGoToRoute('home'),
          keywords: ['go', 'navigate', 'start', 'dashboard'],
        },
        {
          id: 'go-files',
          title: 'Go to Files',
          description: 'Browse the local working copy',
          icon: FolderOpen,
          category: 'Navigation',
          action: () => onGoToRoute('files'),
          keywords: ['go', 'navigate', 'explorer', 'working', 'copy'],
        },
        {
          id: 'go-repo-browser',
          title: 'Go to Repository browser',
          description: 'Browse repository contents on the server',
          icon: Globe,
          category: 'Navigation',
          action: () => onGoToRoute('repo-browser'),
          keywords: ['go', 'navigate', 'remote', 'server', 'svn'],
        }
      );
      if (currentPath) {
        items.push({
          id: 'go-history',
          title: 'Go to History',
          description: `Revision history for ${currentPath}`,
          icon: History,
          category: 'Navigation',
          action: () => onGoToRoute('history'),
          keywords: ['go', 'navigate', 'log', 'revisions'],
        });
      }
    }

    // Navigation
    if (onRefresh) {
      items.push({
        id: 'refresh',
        title: 'Refresh',
        description: 'Reload current directory',
        icon: RefreshCw,
        shortcut: 'F5',
        category: 'Navigation',
        action: onRefresh,
        keywords: ['reload', 'update'],
      });
    }

    // Recent paths
    recentPaths.slice(0, 5).forEach((path, index) => {
      if (onGoToPath) {
        items.push({
          id: `recent-${index}`,
          title: `Go to: ${path.split(/[/\\]/).pop() || path}`,
          description: path,
          icon: Folder,
          category: 'Recent',
          action: () => onGoToPath(path),
          keywords: ['go', 'navigate', 'open'],
        });
      }
    });

    // Bookmarks
    bookmarks.forEach((bookmark, index) => {
      if (onGoToPath) {
        items.push({
          id: `bookmark-${index}`,
          title: `Bookmark: ${bookmark.name}`,
          description: bookmark.path,
          icon: Star,
          category: 'Bookmarks',
          action: () => onGoToPath(bookmark.path),
          keywords: ['go', 'navigate', 'favorite'],
        });
      }
    });

    if (onAddBookmark && currentPath) {
      items.push({
        id: 'add-bookmark',
        title: 'Add bookmark',
        description: 'Bookmark current location',
        icon: StarOff,
        category: 'Bookmarks',
        action: onAddBookmark,
        keywords: ['favorite', 'save'],
      });
    }

    // View
    if (onTogglePreview) {
      items.push({
        id: 'toggle-preview',
        title: 'Toggle preview panel',
        description: 'Show/hide file preview',
        icon: Eye,
        shortcut: 'Ctrl+P',
        category: 'View',
        action: onTogglePreview,
        keywords: ['preview', 'panel', 'show'],
      });
    }

    if (onToggleDualPane) {
      items.push({
        id: 'toggle-dual-pane',
        title: 'Toggle dual pane',
        description: 'Show/hide split view',
        icon: Columns2,
        category: 'View',
        action: onToggleDualPane,
        keywords: ['split', 'dual', 'columns'],
      });
    }

    if (onToggleFilters) {
      items.push({
        id: 'toggle-filters',
        title: 'Toggle filter bar',
        description: 'Show/hide file filters',
        icon: Layers,
        category: 'View',
        action: onToggleFilters,
        keywords: ['filter', 'status', 'type'],
      });
    }

    // Tools
    if (onShowNotes) {
      items.push({
        id: 'notes',
        title: 'Quick notes',
        description: 'Open notes panel',
        icon: StickyNote,
        category: 'Tools',
        action: onShowNotes,
        keywords: ['note', 'comment', 'memo'],
      });
    }

    if (onShowShortcuts) {
      items.push({
        id: 'shortcuts',
        title: 'Keyboard shortcuts',
        description: 'View all keyboard shortcuts',
        icon: Keyboard,
        shortcut: '?',
        category: 'Help',
        action: onShowShortcuts,
        keywords: ['help', 'keys', 'bindings'],
      });
    }

    if (onShowStatusLegend) {
      items.push({
        id: 'status-legend',
        title: 'What the status colors mean',
        description: 'Open the Subversion status legend',
        icon: HelpCircle,
        category: 'Help',
        action: onShowStatusLegend,
        keywords: ['status', 'legend', 'colors', 'svn', 'help', 'overlay'],
      });
    }

    // #81: notification center history.
    if (onOpenNotificationCenter) {
      items.push({
        id: 'notification-center',
        title: 'Notification center',
        description: 'Review past notifications and operation results',
        icon: Bell,
        category: 'Help',
        action: onOpenNotificationCenter,
        keywords: ['notifications', 'history', 'alerts', 'toasts', 'bell'],
      });
    }

    if (onOpenSettings) {
      items.push({
        id: 'settings',
        title: 'Open settings',
        description: 'Configure application preferences',
        icon: Settings,
        shortcut: 'Ctrl+,',
        category: 'Tools',
        action: onOpenSettings,
        keywords: ['preferences', 'config', 'options'],
      });
    }

    if (onManagePlugins) {
      items.push({
        id: 'plugins',
        title: 'Manage plugins',
        description: 'Install, configure, and manage plugins',
        icon: Puzzle,
        category: 'Tools',
        action: onManagePlugins,
        keywords: ['plugin', 'extension', 'addon', 'manage'],
      });
    }

    if (onOpenAiReviewCenter) {
      items.push({
        id: 'ai-review-center',
        title: 'Open AI Review Center',
        description: 'Review AI findings and commit plans',
        icon: BrainCircuit,
        shortcut: 'Ctrl+Shift+A',
        category: 'Tools',
        action: onOpenAiReviewCenter,
        keywords: ['ai', 'review', 'findings', 'commit', 'plan'],
      });
    }

    if (onManageCredentials) {
      items.push({
        id: 'manage-credentials',
        title: 'Manage credentials',
        description: 'Open settings on the authentication tab',
        icon: KeyRound,
        category: 'Tools',
        action: onManageCredentials,
        keywords: ['auth', 'login', 'password', 'settings', 'credentials'],
      });
    }

    // View
    if (onToggleTheme) {
      items.push({
        id: 'toggle-theme',
        title: 'Toggle light/dark theme',
        description: 'Switch between light and dark appearance',
        icon: Sun,
        category: 'View',
        action: onToggleTheme,
        keywords: ['theme', 'appearance', 'dark', 'light', 'mode'],
      });
    }

    // Window — the titlebar controls
    if (onMinimizeWindow) {
      items.push({
        id: 'window-minimize',
        title: 'Minimize window',
        icon: Minus,
        category: 'Window',
        action: onMinimizeWindow,
        keywords: ['window', 'minimize', 'hide'],
      });
    }

    if (onMaximizeWindow) {
      items.push({
        id: 'window-maximize',
        title: 'Maximize or restore window',
        icon: Square,
        category: 'Window',
        action: onMaximizeWindow,
        keywords: ['window', 'maximize', 'restore', 'fullscreen'],
      });
    }

    if (onCloseWindow) {
      items.push({
        id: 'window-close',
        title: 'Close window',
        icon: X,
        category: 'Window',
        action: onCloseWindow,
        keywords: ['window', 'close', 'quit', 'exit'],
      });
    }

    return items;
  }, [
    onCommit,
    onUpdate,
    onRevert,
    onAdd,
    onDelete,
    onCleanup,
    onResolve,
    onMove,
    onCopy,
    onRename,
    onShowLog,
    onRefresh,
    onOpenSettings,
    onTogglePreview,
    onToggleDualPane,
    onToggleFilters,
    onShowShortcuts,
    onShowNotes,
    onQuickCommit,
    onAddBookmark,
    onGoToPath,
    onBranchTag,
    onTag,
    onBranchTagCompare,
    onSwitch,
    onMerge,
    onRelocate,
    onBlame,
    onProperties,
    onChangelist,
    onShelve,
    onUnshelve,
    onLock,
    onUnlock,
    onExport,
    onImport,
    onRepoBrowser,
    onRevisionGraph,
    onCreatePatch,
    onApplyPatch,
    onManagePlugins,
    onGoToRoute,
    onOpenAiReviewCenter,
    onManageCredentials,
    onToggleTheme,
    onShowStatusLegend,
    onMinimizeWindow,
    onMaximizeWindow,
    onCloseWindow,
    currentPath,
    recentPaths,
    bookmarks,
  ]);

  const deferredQuery = useDeferredValue(query);

  // Recent executions boost entries the user reaches for often.
  const [recentUsage, setRecentUsage] = useState<Record<string, number>>({});

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    void loadPaletteUsage().then((usage) => {
      if (!cancelled) setRecentUsage(usage);
    });
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  const trackUsage = useCallback(
    (commandId: string) => {
      setRecentUsage((previous) => {
        const next = recordPaletteUsage(previous, commandId);
        void savePaletteUsage(next);
        return next;
      });
    },
    []
  );

  // Fuzzy filter + rank: exact > prefix > word-start > substring > subsequence,
  // weighted title > keywords > description > category, recent use boosted.
  const filteredCommands = useMemo(
    () => rankCommands(commands, deferredQuery, recentUsage),
    [commands, deferredQuery, recentUsage]
  );
  const rowVirtualizer = useVirtualizer({
    count: filteredCommands.length,
    getScrollElement: () => listRef.current,
    estimateSize: () => 56,
    getItemKey: (index) => filteredCommands[index]?.id ?? index,
    initialRect: { width: 600, height: 400 },
    overscan: 8,
  });
  const shouldVirtualizeCommands = filteredCommands.length > 80;
  const virtualRows = rowVirtualizer.getVirtualItems();
  const visibleRows =
    virtualRows.length > 0
      ? virtualRows
      : filteredCommands.slice(0, Math.min(filteredCommands.length, 12)).map((cmd, index) => ({
          index,
          key: cmd.id,
          size: 56,
          start: index * 56,
        }));

  // Reset selection when filter changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  // Focus input when opened
  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  // Keyboard navigation
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((prev) => Math.min(prev + 1, filteredCommands.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((prev) => Math.max(prev - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const selected = filteredCommands[selectedIndex];
        if (selected) {
          trackUsage(selected.id);
          selected.action();
          onClose();
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, filteredCommands, selectedIndex, onClose, trackUsage]);

  // Scroll selected item into view
  useEffect(() => {
    if (shouldVirtualizeCommands) {
      rowVirtualizer.scrollToIndex(selectedIndex, { align: 'auto' });
      return;
    }

    const selectedElement = listRef.current?.children[selectedIndex] as HTMLElement | undefined;
    selectedElement?.scrollIntoView?.({ block: 'nearest' });
  }, [rowVirtualizer, selectedIndex, shouldVirtualizeCommands]);

  const handleSelect = useCallback((index: number) => {
    setSelectedIndex(index);
  }, []);

  const handleExecute = useCallback(
    (cmd: CommandItem) => {
      trackUsage(cmd.id);
      cmd.action();
      onClose();
    },
    [onClose, trackUsage]
  );

  if (!isOpen) return null;

  const renderRow = (cmd: CommandItem, index: number, style?: React.CSSProperties) => {
    const Icon = cmd.icon;
    const isSelected = index === selectedIndex;
    return (
      <div
        key={cmd.id}
        onClick={() => handleExecute(cmd)}
        onMouseEnter={() => handleSelect(index)}
        style={style}
        className={`command-palette-item ${isSelected ? 'command-palette-item-active' : 'hover:bg-bg-elevated'}`}
      >
        <div
          className={`flex items-center justify-center w-8 h-8 rounded-lg flex-shrink-0 transition-fast ${
            isSelected ? 'bg-accent/20 text-accent' : 'bg-bg-tertiary text-text-muted'
          }`}
        >
          <Icon className="w-4 h-4" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span
              className={`text-sm font-medium truncate ${isSelected ? 'text-accent' : 'text-text'}`}
            >
              {cmd.title}
            </span>
            {cmd.shortcut && <span className="kbd flex-shrink-0">{cmd.shortcut}</span>}
          </div>
          {cmd.description && (
            <p className="text-xs text-text-muted truncate mt-0.5">{cmd.description}</p>
          )}
          {cmd.command && (
            /* Decorative: the title carries the meaning for assistive tech. */
            <p className="mt-0.5 truncate font-mono text-9.5 text-text-faint" aria-hidden="true">
              {cmd.command}
            </p>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="command-palette">
      {/* Backdrop */}
      <m.div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        variants={variants.backdrop}
        initial="initial"
        animate="animate"
        onClick={onClose}
      />

      {/* Palette */}
      <m.div
        className="relative w-[640px] max-w-[92vw] glass-strong border border-border rounded-2xl shadow-overlay overflow-hidden"
        variants={variants.overlayPanel}
        initial="initial"
        animate="animate"
        transition={springs.overlay}
      >
        {/* Search input */}
        <div className="flex items-center gap-3 px-5 border-b border-border">
          <Search className="w-4 h-4 text-text-muted flex-shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Run a command…"
            className="command-palette-input px-0"
          />
          <span className="kbd flex-shrink-0">esc</span>
        </div>

        {/* Results */}
        <div ref={listRef} className="command-palette-list h-[400px]">
          {filteredCommands.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Search className="w-8 h-8 text-text-faint mb-3" />
              <p className="text-sm text-text-secondary">No commands found</p>
              <p className="text-xs text-text-muted mt-1">Try a different search</p>
            </div>
          ) : shouldVirtualizeCommands ? (
            <div className="relative" style={{ height: `${rowVirtualizer.getTotalSize()}px` }}>
              {visibleRows.map((virtualRow) =>
                renderRow(filteredCommands[virtualRow.index], virtualRow.index, {
                  position: 'absolute',
                  left: 0,
                  top: 0,
                  width: '100%',
                  height: `${virtualRow.size}px`,
                  transform: `translateY(${virtualRow.start}px)`,
                })
              )}
            </div>
          ) : (
            filteredCommands.map((cmd, index) => renderRow(cmd, index))
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-2.5 bg-bg-secondary/50 border-t border-border text-xs text-text-muted">
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-1.5">
              <span className="kbd">↑</span>
              <span className="kbd">↓</span>
              navigate
            </span>
            <span className="flex items-center gap-1.5">
              <span className="kbd">
                <CornerDownLeft className="w-3 h-3" />
              </span>
              select
            </span>
          </div>
          <span>{filteredCommands.length} commands</span>
        </div>
      </m.div>
    </div>
  );
}
