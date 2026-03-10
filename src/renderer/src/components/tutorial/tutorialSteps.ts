import {
  Sparkles,
  FolderOpen,
  FileText,
  RefreshCw,
  FileDiff,
  History,
  Undo2,
  Keyboard,
  CheckCircle,
} from 'lucide-react';
import type { TutorialStep } from './types';
import { WelcomeStep } from './WelcomeStep';
import { WorkingCopyStep } from './WorkingCopyStep';
import { StatusViewStep } from './StatusViewStep';
import { CommitUpdateStep } from './CommitUpdateStep';
import { DiffViewerStep } from './DiffViewerStep';
import { LogHistoryStep } from './LogHistoryStep';
import { RevertResolveStep } from './RevertResolveStep';
import { ShortcutsStep } from './ShortcutsStep';
import { CompleteStep } from './CompleteStep';

/**
 * Tutorial steps in order
 */
export const TUTORIAL_STEPS: TutorialStep[] = [
  {
    id: 'welcome',
    title: 'Welcome',
    description: 'Introduction to ShellySVN',
    icon: Sparkles,
    component: WelcomeStep,
  },
  {
    id: 'working-copy',
    title: 'Working Copies',
    description: 'Opening and managing working copies',
    icon: FolderOpen,
    component: WorkingCopyStep,
  },
  {
    id: 'status-view',
    title: 'File Status',
    description: 'Understanding status indicators',
    icon: FileText,
    component: StatusViewStep,
  },
  {
    id: 'commit-update',
    title: 'Commit & Update',
    description: 'Syncing with the repository',
    icon: RefreshCw,
    component: CommitUpdateStep,
  },
  {
    id: 'diff-viewer',
    title: 'Diff Viewer',
    description: 'Viewing file changes',
    icon: FileDiff,
    component: DiffViewerStep,
  },
  {
    id: 'log-history',
    title: 'History & Log',
    description: 'Browsing commit history',
    icon: History,
    component: LogHistoryStep,
  },
  {
    id: 'revert-resolve',
    title: 'Undo & Resolve',
    description: 'Reverting and conflict resolution',
    icon: Undo2,
    component: RevertResolveStep,
  },
  {
    id: 'shortcuts',
    title: 'Keyboard Shortcuts',
    description: 'Work faster with shortcuts',
    icon: Keyboard,
    component: ShortcutsStep,
  },
  {
    id: 'complete',
    title: 'All Done!',
    description: 'Ready to start',
    icon: CheckCircle,
    component: CompleteStep,
  },
];

/**
 * Get a tutorial step by ID
 */
export function getTutorialStep(id: string): TutorialStep | undefined {
  return TUTORIAL_STEPS.find((step) => step.id === id);
}

/**
 * Get the total number of tutorial steps
 */
export function getTotalSteps(): number {
  return TUTORIAL_STEPS.length;
}
