import { useState, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  CheckCircle,
  ChevronRight,
  ChevronLeft,
  FileText,
  RefreshCw,
  List,
  Layers,
  Eye,
  Check,
  Info,
  AlertCircle,
  Wrench,
  Loader2,
  Columns2,
} from 'lucide-react';
import type { SvnDiffResult } from '@shared/types';
import { ThreeWayMergeEditor } from './ThreeWayMergeEditor';
import { VirtualizedDiffViewer } from './VirtualizedDiffViewer';
import { DialogBase } from './DialogBase';
import { ConflictAiExplainer } from '../ai/ConflictAiExplainer';
import { useSettings } from '@renderer/hooks/useSettings';
import { resolveExternalToolForPath } from '@renderer/utils/externalToolOverrides';
import { PropertyConflictPanel } from './PropertyConflictPanel';
import { BinaryConflictPanel } from './BinaryConflictPanel';
import {
  type ConflictKind,
  type ConflictResolutionMode,
  POSTPONE_MODE_INFO,
  acceptModeLabel,
  acceptModeOutcome,
  applicableAcceptModes,
  normalizeWizardResolution,
  toSvnResolveArg,
} from '@renderer/lib/conflictAcceptModes';
import {
  type BatchResolvePlan,
  type ConflictDescriptor,
  classifyConflictFromArtifacts,
  conflictStats,
  createConflictItems,
  looksBinaryContent,
  markItemFailed,
  markItemInFlight,
  markItemResolved,
  markItemSkipped,
  planBatchResolve,
  summarizeBatchPlan,
} from '@renderer/lib/conflictWizardState';
import { buildQuickCompareDiff, summarizeQuickCompare } from '@renderer/lib/quickCompare';

interface ConflictWizardProps {
  isOpen: boolean;
  onClose: () => void;
  conflictPaths: string[];
  workingCopyPath: string;
  onAllResolved?: () => void;
  /**
   * Optional richer input (#55): when the caller already knows conflict kinds
   * (e.g. from `svn status` entries), pass them here to skip artifact probing.
   * `conflictPaths` remains the source of truth for which paths are included.
   */
  conflicts?: ConflictDescriptor[];
}

interface ConflictFile {
  path: string;
  kind: ConflictKind;
  status: 'pending' | 'in-progress' | 'resolved' | 'skipped';
  resolution?: ConflictResolutionMode | 'merged' | 'custom';
  error?: string;
  proposal?: {
    confidence: number;
    unresolvedQuestions: string[];
    sourceFingerprint: string;
  };
  sourceFingerprint?: string;
  proposalStale?: boolean;
}

type WizardStep = 'overview' | 'select' | 'resolve' | 'review' | 'complete';

interface MergeEditorContents {
  baseContent: string;
  mineContent: string;
  theirsContent: string;
  mergedContent: string;
}

interface ConflictArtifactPaths {
  basePath: string;
  minePath: string;
  theirsPath: string;
  mergedPath: string;
}

/** Sides previewable straight from the working copy / repository. */
type PreviewSide = 'mine' | 'theirs' | 'base' | 'merged';

function conflictSourceFingerprint(contents: MergeEditorContents): string {
  const source = `${contents.baseContent}\u0000${contents.mineContent}\u0000${contents.theirsContent}`;
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${source.length}-${(hash >>> 0).toString(16)}`;
}

function getDirectoryAndBaseName(filePath: string): {
  dirPath: string;
  baseName: string;
  sep: string;
} {
  const lastSepIndex = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
  return {
    dirPath: lastSepIndex >= 0 ? filePath.substring(0, lastSepIndex) : filePath,
    baseName: lastSepIndex >= 0 ? filePath.substring(lastSepIndex + 1) : filePath,
    sep: filePath.includes('\\') ? '\\' : '/',
  };
}

export async function resolveConflictArtifactPaths(
  filePath: string
): Promise<ConflictArtifactPaths> {
  const { dirPath, baseName, sep } = getDirectoryAndBaseName(filePath);
  const dirFiles = await window.api.fs.listDirectory(dirPath);
  const artifactNames = dirFiles
    .filter((file) => file.name.startsWith(`${baseName}.`))
    .map((file) => file.name);
  const revisionPattern = new RegExp(
    `^${baseName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.r(\\d+)$`
  );
  const revisionFiles = artifactNames
    .filter((name) => revisionPattern.test(name))
    .map((name) => ({
      name,
      revision: parseInt(revisionPattern.exec(name)![1], 10),
    }))
    .toSorted((a, b) => a.revision - b.revision);

  const basePath =
    revisionFiles.length > 0 ? `${dirPath}${sep}${revisionFiles[0].name}` : `${filePath}.rBASE`;
  const theirsPath =
    revisionFiles.length > 0
      ? `${dirPath}${sep}${revisionFiles[revisionFiles.length - 1].name}`
      : `${filePath}.rTHEIRS`;
  const minePath = artifactNames.includes(`${baseName}.mine`)
    ? `${dirPath}${sep}${baseName}.mine`
    : `${filePath}.mine`;

  return {
    basePath,
    minePath,
    theirsPath,
    mergedPath: filePath,
  };
}

async function readConflictFile(path: string): Promise<string> {
  const result = await window.api.fs.readFile(path);
  if (!result.success) {
    throw new Error(result.error || `Failed to read ${path}`);
  }
  return result.content ?? '';
}

function decodeBase64Text(base64: string): string {
  const binary = atob(base64);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
}

/**
 * Preview one side of a conflict (#55). Mine/theirs/merged come from the
 * working-copy artifact files SVN leaves behind; base prefers `svn cat` at
 * BASE (always available, even when artifacts were cleaned up) and falls back
 * to the lowest `.rN` artifact.
 */
export async function loadConflictPreview(
  filePath: string,
  side: PreviewSide
): Promise<{ content: string; binary: boolean }> {
  if (side === 'merged') {
    const content = await readConflictFile(filePath);
    return { content, binary: looksBinaryContent(content) };
  }
  if (side === 'base') {
    try {
      const cat = await window.api.svn.cat(filePath, 'BASE');
      const content = decodeBase64Text(cat.contentBase64);
      return { content, binary: cat.binary || looksBinaryContent(content) };
    } catch {
      // No repository access / svn cat failed — fall through to the artifact.
    }
  }
  const paths = await resolveConflictArtifactPaths(filePath);
  const target = side === 'mine' ? paths.minePath : side === 'theirs' ? paths.theirsPath : paths.basePath;
  const content = await readConflictFile(target);
  return { content, binary: looksBinaryContent(content) };
}

export async function loadMergeEditorContents(filePath: string): Promise<MergeEditorContents> {
  const paths = await resolveConflictArtifactPaths(filePath);
  const [baseContent, mineContent, theirsContent, mergedContent] = await Promise.all([
    readConflictFile(paths.basePath),
    readConflictFile(paths.minePath),
    readConflictFile(paths.theirsPath),
    readConflictFile(paths.mergedPath),
  ]);

  return {
    baseContent,
    mineContent,
    theirsContent,
    mergedContent,
  };
}

const KIND_DESCRIPTIONS: Record<ConflictKind, string> = {
  text: 'Both sides changed the same lines of this file and SVN could not merge them automatically.',
  property: 'At least one versioned property changed differently on both sides.',
  tree:
    'A structural change (add, delete, move or rename) collided with a change on the other side.',
  binary:
    'The file is binary, so the two versions cannot be merged line by line — one side must win.',
};

export function ConflictResolutionWizard({
  isOpen,
  onClose,
  conflictPaths,
  conflicts,
  workingCopyPath,
  onAllResolved,
}: ConflictWizardProps) {
  const queryClient = useQueryClient();
  const { settings } = useSettings();
  const [currentStep, setCurrentStep] = useState<WizardStep>('overview');
  const [conflictFiles, setConflictFiles] = useState<ConflictFile[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [showMergeEditor, setShowMergeEditor] = useState(false);
  const [autoAdvance, setAutoAdvance] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isLaunchingExternalTool, setIsLaunchingExternalTool] = useState(false);
  const [externalToolError, setExternalToolError] = useState<string | null>(null);
  const [mergeEditorContents, setMergeEditorContents] = useState<MergeEditorContents | null>(null);
  const [mergeEditorError, setMergeEditorError] = useState<string | null>(null);
  const [isLoadingMergeEditor, setIsLoadingMergeEditor] = useState(false);

  // Preview + quick compare state (#55)
  const [previewSide, setPreviewSide] = useState<PreviewSide | null>(null);
  const [previewContent, setPreviewContent] = useState<string | null>(null);
  const [previewBinary, setPreviewBinary] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [quickCompare, setQuickCompare] = useState<SvnDiffResult | null>(null);
  const [quickCompareSummary, setQuickCompareSummary] = useState<string | null>(null);
  const [quickCompareLoading, setQuickCompareLoading] = useState(false);
  const [quickCompareError, setQuickCompareError] = useState<string | null>(null);

  // Batch resolve state (#55): default mode + per-conflict overrides
  const [batchMode, setBatchMode] = useState<ConflictResolutionMode>('mine-full');
  const [batchOverrides, setBatchOverrides] = useState<Record<string, ConflictResolutionMode>>({});
  const [batchConfirmPlan, setBatchConfirmPlan] = useState<BatchResolvePlan | null>(null);
  const [batchError, setBatchError] = useState<string | null>(null);

  // Initialize conflict files
  useEffect(() => {
    if (isOpen && conflictPaths.length > 0) {
      const descriptors: ConflictDescriptor[] =
        conflicts && conflicts.length === conflictPaths.length
          ? conflictPaths.map((path, index) => ({ path, kind: conflicts[index]?.kind }))
          : conflictPaths.map((path) => ({ path }));
      setConflictFiles(createConflictItems(descriptors) as ConflictFile[]);
      setCurrentIndex(0);
      setCurrentStep('overview');
      setPreviewSide(null);
      setQuickCompare(null);
      setQuickCompareSummary(null);
      setBatchMode('mine-full');
      setBatchOverrides({});
      setBatchConfirmPlan(null);
      setBatchError(null);
    }
  }, [isOpen, conflictPaths, conflicts]);

  // Refine conflict kinds from on-disk artifacts (property/tree/binary detection, #56).
  useEffect(() => {
    if (!isOpen || conflictPaths.length === 0) return;
    let cancelled = false;
    const probe = async () => {
      for (const path of conflictPaths) {
        try {
          const { dirPath } = getDirectoryAndBaseName(path);
          const dirFiles = await window.api.fs?.listDirectory(dirPath);
          if (!dirFiles || cancelled) continue;
          const classification = classifyConflictFromArtifacts(
            path,
            dirFiles.map((file) => file.name)
          );
          let kind: ConflictKind = classification.kind;
          if (kind === 'text') {
            // Binary conflicts leave the same artifacts; sniff the file itself.
            try {
              const working = await window.api.fs?.readFile(path);
              if (working?.success && looksBinaryContent(working.content ?? '')) {
                kind = 'binary';
              }
            } catch {
              // Not readable — treat as text.
            }
          }
          if (cancelled) return;
          setConflictFiles((previous) =>
            previous.map((file) => (file.path === path && file.status === 'pending' ? { ...file, kind } : file))
          );
        } catch {
          // No filesystem access (e.g. tests) — keep the default 'text' kind.
        }
      }
    };
    void probe();
    return () => {
      cancelled = true;
    };
  }, [isOpen, conflictPaths]);

  // Get current conflict file
  const currentFile = conflictFiles[currentIndex];
  const currentKind: ConflictKind = currentFile?.kind ?? 'text';
  const externalMergeTool = currentFile
    ? resolveExternalToolForPath(settings.diffMerge, currentFile.path, 'merge')
    : '';
  const hasExternalMergeTool = externalMergeTool !== '';

  // Statistics
  const stats = conflictStats(conflictFiles);

  // Navigation
  const goToNextStep = () => {
    const steps: WizardStep[] = ['overview', 'select', 'resolve', 'review', 'complete'];
    const nextIndex = steps.indexOf(currentStep) + 1;
    if (nextIndex < steps.length) {
      setCurrentStep(steps[nextIndex]);
    }
  };

  const goToPrevStep = () => {
    const steps: WizardStep[] = ['overview', 'select', 'resolve', 'review', 'complete'];
    const prevIndex = steps.indexOf(currentStep) - 1;
    if (prevIndex >= 0) {
      setCurrentStep(steps[prevIndex]);
    }
  };

  // Handle resolution
  const handleResolve = async (resolution: ConflictResolutionMode | 'merged' | 'custom') => {
    if (!currentFile) return;

    const mode = normalizeWizardResolution(resolution);
    const svnArg = toSvnResolveArg(mode);

    if (svnArg === undefined) {
      // Postpone: leave the conflict untouched, move on in the queue.
      handleDefer();
      return;
    }

    setIsProcessing(true);

    try {
      // Keep the UI provisional until SVN confirms that every conflict marker
      // (text, property, or tree) has actually cleared.
      setConflictFiles((prev) =>
        prev.map((f, i) => (i === currentIndex ? { ...f, status: 'in-progress', resolution: mode } : f))
      );

      await window.api.svn.resolve(currentFile.path, svnArg);
      setConflictFiles((prev) =>
        prev.map((f, i) =>
          i === currentIndex ? { ...f, status: 'resolved', resolution: mode, error: undefined } : f
        )
      );

      // Invalidate status cache
      queryClient.invalidateQueries({ queryKey: ['svn:status', workingCopyPath] });

      // Auto-advance to next conflict
      const nextIndex = conflictFiles.findIndex(
        (file, index) => index !== currentIndex && file.status !== 'resolved'
      );
      if (autoAdvance && nextIndex >= 0) {
        setCurrentIndex(nextIndex);
      } else if (nextIndex < 0) {
        setCurrentStep('complete');
      }
    } catch (err) {
      console.error('Failed to resolve conflict:', err);
      setConflictFiles((prev) =>
        prev.map((f, i) =>
          i === currentIndex ? { ...f, status: 'pending', error: (err as Error).message } : f
        )
      );
    } finally {
      setIsProcessing(false);
    }
  };

  // Skip current conflict
  const handleDefer = () => {
    setConflictFiles((prev) => prev.map((f, i) => (i === currentIndex ? { ...f, status: 'skipped' } : f)));

    const nextIndex = conflictFiles.findIndex(
      (file, index) => index !== currentIndex && file.status === 'pending'
    );
    if (nextIndex >= 0) setCurrentIndex(nextIndex);
  };

  const handleNextUnresolved = () => {
    const nextIndex = conflictFiles.findIndex(
      (file, index) => index !== currentIndex && file.status !== 'resolved'
    );
    if (nextIndex >= 0) {
      setCurrentIndex(nextIndex);
      setCurrentStep('resolve');
    }
  };

  const handleReopen = (index: number) => {
    setConflictFiles((previous) =>
      previous.map((file, fileIndex) =>
        fileIndex === index
          ? { ...file, status: 'pending', resolution: undefined, error: undefined }
          : file
      )
    );
    setCurrentIndex(index);
    setCurrentStep('resolve');
  };

  // Open merge editor
  const handleOpenMergeEditor = async () => {
    if (!currentFile) return;

    setIsLoadingMergeEditor(true);
    setMergeEditorError(null);

    try {
      const contents = await loadMergeEditorContents(currentFile.path);
      const fingerprint = conflictSourceFingerprint(contents);
      setMergeEditorContents(contents);
      setConflictFiles((previous) =>
        previous.map((file, index) =>
          index === currentIndex
            ? {
                ...file,
                proposalStale:
                  file.proposal !== undefined && file.proposal.sourceFingerprint !== fingerprint,
                sourceFingerprint: fingerprint,
              }
            : file
        )
      );
      setShowMergeEditor(true);
    } catch (err) {
      setMergeEditorError((err as Error).message || 'Failed to load merge editor files');
    } finally {
      setIsLoadingMergeEditor(false);
    }
  };

  // Open external merge tool
  const handleOpenExternalMergeTool = async () => {
    if (!currentFile || !hasExternalMergeTool) return;

    setIsLaunchingExternalTool(true);
    setExternalToolError(null);

    try {
      // Detect actual conflict files in the directory
      // SVN creates files with patterns: filename.mine, filename.r<old-rev>, filename.r<new-rev>

      // Extract directory and filename using cross-platform approach
      const lastSepIndex = Math.max(
        currentFile.path.lastIndexOf('/'),
        currentFile.path.lastIndexOf('\\')
      );
      const dirPath =
        lastSepIndex >= 0 ? currentFile.path.substring(0, lastSepIndex) : currentFile.path;
      const baseName =
        lastSepIndex >= 0 ? currentFile.path.substring(lastSepIndex + 1) : currentFile.path;

      // Determine path separator for constructing paths
      const sep = currentFile.path.includes('\\') ? '\\' : '/';

      // List directory to find conflict files
      const dirFiles = await window.api.fs.listDirectory(dirPath);

      // Find conflict files matching the pattern
      // SVN conflict file patterns:
      // - filename.mine (local changes)
      // - filename.r<revision> (base and theirs - the lower revision is base, higher is theirs)
      const artifactFileNames = dirFiles
        .filter((f) => f.name.startsWith(baseName + '.'))
        .map((f) => f.name);

      const minePattern = `${baseName}.mine`;
      const revisionPattern = new RegExp(
        `^${baseName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.r(\\d+)$`
      );

      const mineFile = artifactFileNames.find((f) => f === minePattern);
      const revisionFiles = artifactFileNames
        .filter((f) => revisionPattern.test(f))
        .map((f) => ({
          name: f,
          revision: parseInt(revisionPattern.exec(f)![1], 10),
        }))
        .toSorted((a, b) => a.revision - b.revision);

      // Determine paths: base is lower revision, theirs is higher revision
      let basePath: string;
      let theirsPath: string;
      let minePath: string;

      const missingFiles: string[] = [];

      if (revisionFiles.length >= 2) {
        // We have both base and theirs revision files
        basePath = `${dirPath}${sep}${revisionFiles[0].name}`;
        theirsPath = `${dirPath}${sep}${revisionFiles[revisionFiles.length - 1].name}`;
      } else if (revisionFiles.length === 1) {
        // Only one revision file found - use it for both (unusual but handle gracefully)
        basePath = `${dirPath}${sep}${revisionFiles[0].name}`;
        theirsPath = basePath;
        console.warn(
          '[ConflictWizard] Only one revision file found, using same for base and theirs'
        );
      } else {
        // No revision files found - use placeholder that will fail validation
        basePath = `${currentFile.path}.rBASE`;
        theirsPath = `${currentFile.path}.rTHEIRS`;
        missingFiles.push('base/theirs revision files (.r<rev>)');
      }

      if (mineFile) {
        minePath = `${dirPath}${sep}${mineFile}`;
      } else {
        minePath = `${currentFile.path}.mine`;
        missingFiles.push('local file (.mine)');
      }

      // If we're missing conflict files, show a warning but still try to proceed
      if (missingFiles.length > 0) {
        console.warn('[ConflictWizard] Missing conflict files:', missingFiles);
        setExternalToolError(
          `Warning: Could not find ${missingFiles.join(', ')}. ` +
            `The conflict files may have been moved or the conflict may be resolved. ` +
            `Please verify the conflict still exists.`
        );
        // Still try to launch - the external tool validation will fail with a clearer error
      }

      const result = await window.api.external.openMergeTool(
        externalMergeTool,
        basePath,
        minePath,
        theirsPath,
        currentFile.path
      );

      if (!result.success) {
        setExternalToolError(result.error || 'Failed to launch external merge tool');
      } else if (missingFiles.length === 0) {
        // Clear any previous warning if launch succeeded
        setExternalToolError(null);
      }
    } catch (err) {
      setExternalToolError(`Failed to launch external merge tool: ${(err as Error).message}`);
    } finally {
      setIsLaunchingExternalTool(false);
    }
  };

  // Mark as resolved after using external tool
  const handleMarkResolvedAfterExternal = async () => {
    await handleResolve('merged');
  };

  // Handle merge editor save
  const handleMergeEditorSave = async (content: string) => {
    if (!currentFile) return;

    const result = await window.api.fs.writeFile(currentFile.path, content);
    if (!result.success) {
      throw new Error(result.error || 'Failed to save merged content');
    }

    // Mark as resolved
    await handleResolve('merged');
    setShowMergeEditor(false);
  };

  // Preview one side of the current conflict (#55)
  const handlePreview = async (side: PreviewSide) => {
    if (!currentFile) return;
    setPreviewSide(side);
    setPreviewLoading(true);
    setPreviewError(null);
    try {
      const { content, binary } = await loadConflictPreview(currentFile.path, side);
      setPreviewContent(content);
      setPreviewBinary(binary);
    } catch (err) {
      setPreviewContent(null);
      setPreviewBinary(false);
      setPreviewError((err as Error).message || `Failed to load the ${side} version`);
    } finally {
      setPreviewLoading(false);
    }
  };

  // Side-by-side mine vs theirs quick compare on the shared diff surface (#55)
  const handleQuickCompare = async () => {
    if (!currentFile) return;
    setQuickCompareLoading(true);
    setQuickCompareError(null);
    try {
      const [mine, theirs] = await Promise.all([
        loadConflictPreview(currentFile.path, 'mine'),
        loadConflictPreview(currentFile.path, 'theirs'),
      ]);
      if (mine.binary || theirs.binary) {
        setQuickCompare(null);
        setQuickCompareSummary(null);
        setQuickCompareError('Binary content cannot be compared line by line.');
        return;
      }
      setQuickCompare(
        buildQuickCompareDiff({
          oldLabel: 'Mine (your changes)',
          newLabel: 'Theirs (incoming changes)',
          oldText: mine.content,
          newText: theirs.content,
        })
      );
      setQuickCompareSummary(summarizeQuickCompare(mine.content, theirs.content));
    } catch (err) {
      setQuickCompareError((err as Error).message || 'Failed to compare versions');
    } finally {
      setQuickCompareLoading(false);
    }
  };

  // Batch resolution (#55): one action, optional per-conflict mode overrides,
  // and a final confirmation summarizing the chosen action per conflict.
  const executeBatch = async (plan: BatchResolvePlan) => {
    setIsProcessing(true);
    setBatchError(null);
    const statusByPath = new Map(conflictFiles.map((file) => [file.path, file.status]));
    try {
      for (const step of plan.steps) {
        setConflictFiles((prev) => markItemInFlight(prev, step.path, step.mode) as ConflictFile[]);
        try {
          const result = await window.api.svn.resolve(step.path, step.mode);
          if (result && result.success === false) {
            throw new Error(`svn resolve --accept ${step.mode} failed for ${step.path}`);
          }
          statusByPath.set(step.path, 'resolved');
          setConflictFiles((prev) => markItemResolved(prev, step.path) as ConflictFile[]);
        } catch (err) {
          statusByPath.set(step.path, 'pending');
          setConflictFiles((prev) =>
            markItemFailed(prev, step.path, (err as Error).message) as ConflictFile[]
          );
        }
      }
      for (const path of plan.postponedPaths) {
        statusByPath.set(path, 'skipped');
        setConflictFiles((prev) => markItemSkipped(prev, path) as ConflictFile[]);
      }
      queryClient.invalidateQueries({ queryKey: ['svn:status', workingCopyPath] });
      setBatchConfirmPlan(null);
      setBatchOverrides({});

      const failures = [...statusByPath.values()].filter((status) => status === 'pending').length;
      const everyResolved = [...statusByPath.values()].every((status) => status === 'resolved');
      if (everyResolved) {
        setCurrentStep('complete');
      } else if (failures > 0) {
        setBatchError(`${failures} conflict(s) failed to resolve — see the review step.`);
      }
    } finally {
      setIsProcessing(false);
    }
  };

  const handleResolveAll = async (mode: ConflictResolutionMode) => {
    await executeBatch(planBatchResolve(conflictFiles, mode));
  };

  const handleReviewBatch = () => {
    setBatchConfirmPlan(planBatchResolve(conflictFiles, batchMode, batchOverrides));
  };

  // Finish
  const handleFinish = () => {
    if (conflictFiles.every((file) => file.status === 'resolved')) onAllResolved?.();
    onClose();
  };

  if (!isOpen) return null;

  const applicableModes = applicableAcceptModes(currentKind);
  const primaryModes = applicableModes.filter((mode) => mode.value === 'mine-full' || mode.value === 'theirs-full');
  const advancedModes = applicableModes.filter(
    (mode) => mode.value !== 'mine-full' && mode.value !== 'theirs-full'
  );
  const unresolvedForBatch = conflictFiles.filter((file) => file.status !== 'resolved');
  const batchConfirmation = batchConfirmPlan ? summarizeBatchPlan(batchConfirmPlan) : [];

  return (
    <DialogBase
      isOpen={isOpen}
      onClose={onClose}
      dialogId="conflict-resolution-wizard"
      className="w-[900px] max-w-[95vw] h-[85vh]"
      draggable
      resizable
      minWidth={560}
      minHeight={420}
      title={
        <>
          <Layers className="w-5 h-5 text-warning" />
          Conflict Resolution Wizard
        </>
      }
      headerExtras={
        <div className="flex items-center gap-1 text-xs text-text-muted">
          {stats.resolved}/{stats.total} resolved
        </div>
      }
    >
      <>
        {/* Step indicator */}
        <div className="flex-shrink-0 px-6 py-3 bg-bg-secondary border-b border-border">
          <div className="flex items-center justify-between">
            {(['overview', 'select', 'resolve', 'review'] as WizardStep[]).map((step, index) => (
              <div key={step} className="flex items-center">
                <button
                  onClick={() => setCurrentStep(step)}
                  className={`
                    flex items-center gap-2 px-3 py-2 rounded-lg transition-fast
                    ${
                      currentStep === step
                        ? 'bg-accent/20 text-accent'
                        : index < ['overview', 'select', 'resolve', 'review'].indexOf(currentStep)
                          ? 'text-svn-added hover:bg-bg-elevated'
                          : 'text-text-muted hover:bg-bg-elevated'
                    }
                  `}
                >
                  <span
                    className={`
                    w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium
                    ${
                      currentStep === step
                        ? 'bg-accent text-white'
                        : index < ['overview', 'select', 'resolve', 'review'].indexOf(currentStep)
                          ? 'bg-svn-added text-white'
                          : 'bg-bg-tertiary text-text-muted'
                    }
                  `}
                  >
                    {index + 1}
                  </span>
                  <span className="capitalize hidden sm:inline">{step}</span>
                </button>
                {index < 3 && <ChevronRight className="w-4 h-4 text-text-faint mx-2" />}
              </div>
            ))}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto">
          {/* Overview Step */}
          {currentStep === 'overview' && (
            <div className="p-6 space-y-6">
              <div className="text-center py-8">
                <div className="w-16 h-16 rounded-full bg-warning/20 flex items-center justify-center mx-auto mb-4">
                  <AlertTriangle className="w-8 h-8 text-warning" />
                </div>
                <h3 className="text-xl font-medium text-text mb-2">
                  {stats.total} Conflicts Found
                </h3>
                <p className="text-text-secondary max-w-md mx-auto">
                  Your working copy has conflicts that need to be resolved before you can commit.
                  This wizard will guide you through resolving each conflict.
                </p>
              </div>

              {/* Conflict summary */}
              <div className="grid grid-cols-2 gap-4 max-w-md mx-auto">
                <div className="bg-bg-tertiary rounded-lg p-4 text-center">
                  <FileText className="w-6 h-6 text-warning mx-auto mb-2" />
                  <p className="text-2xl font-bold text-text">{stats.total}</p>
                  <p className="text-xs text-text-muted">Total Conflicts</p>
                </div>
                <div className="bg-bg-tertiary rounded-lg p-4 text-center">
                  <List className="w-6 h-6 text-accent mx-auto mb-2" />
                  <p className="text-2xl font-bold text-text">
                    {conflictPaths.filter((p) => !p.includes('.')).length}
                  </p>
                  <p className="text-xs text-text-muted">Directories</p>
                </div>
              </div>

              {/* Quick actions */}
              <div className="border border-border rounded-lg p-4 max-w-lg mx-auto">
                <h4 className="text-sm font-medium text-text mb-3">Quick Actions</h4>
                <div className="space-y-2">
                  <button
                    onClick={() => void handleResolveAll('mine-full')}
                    disabled={isProcessing}
                    className="w-full btn btn-secondary justify-start"
                  >
                    <Check className="w-4 h-4" />
                    Resolve All Using Mine
                    <span className="text-xs text-text-muted ml-auto">Keep your changes</span>
                  </button>
                  <button
                    onClick={() => void handleResolveAll('theirs-full')}
                    disabled={isProcessing}
                    className="w-full btn btn-secondary justify-start"
                  >
                    <RefreshCw className="w-4 h-4" />
                    Resolve All Using Theirs
                    <span className="text-xs text-text-muted ml-auto">Accept incoming</span>
                  </button>
                </div>
              </div>

              {/* Batch resolve with per-conflict mode overrides (#55) */}
              <div className="border border-border rounded-lg p-4 max-w-lg mx-auto" data-testid="batch-resolve-panel">
                <h4 className="text-sm font-medium text-text mb-1">Batch Resolve</h4>
                <p className="text-xs text-text-secondary mb-3">
                  Pick one default resolution for everything, override individual conflicts, then
                  confirm exactly what will run.
                </p>

                <label className="flex items-center gap-2 text-sm text-text-secondary mb-3">
                  <span className="text-xs whitespace-nowrap">Default mode</span>
                  <select
                    value={batchMode}
                    onChange={(event) => setBatchMode(event.target.value as ConflictResolutionMode)}
                    disabled={isProcessing}
                    className="input flex-1 py-1 text-xs"
                    aria-label="Default resolution mode"
                  >
                    {applicableAcceptModes('text').map((mode) => (
                      <option key={mode.value} value={mode.value}>
                        {mode.label}
                      </option>
                    ))}
                    <option value="postpone">{POSTPONE_MODE_INFO.label}</option>
                  </select>
                </label>

                {unresolvedForBatch.length > 0 && (
                  <div className="space-y-1.5 mb-3 max-h-44 overflow-auto pr-1">
                    {unresolvedForBatch.map((file) => (
                      <div key={file.path} className="flex items-center gap-2 text-xs">
                        <span
                          className="flex-1 truncate font-mono text-text-secondary"
                          title={file.path}
                        >
                          {file.path.split(/[/\\]/).pop()}
                        </span>
                        <span className="text-[10px] uppercase text-text-faint">{file.kind}</span>
                        <select
                          value={batchOverrides[file.path] ?? ''}
                          onChange={(event) =>
                            setBatchOverrides((previous) => {
                              const value = event.target.value;
                              if (value === '') {
                                const { [file.path]: _removed, ...rest } = previous;
                                return rest;
                              }
                              return { ...previous, [file.path]: value as ConflictResolutionMode };
                            })
                          }
                          disabled={isProcessing}
                          className="input py-0.5 text-xs w-40"
                          aria-label={`Override for ${file.path.split(/[/\\]/).pop()}`}
                        >
                          <option value="">Use default</option>
                          {applicableAcceptModes(file.kind).map((mode) => (
                            <option key={mode.value} value={mode.value}>
                              {mode.label}
                            </option>
                          ))}
                          <option value="postpone">{POSTPONE_MODE_INFO.label}</option>
                        </select>
                      </div>
                    ))}
                  </div>
                )}

                {batchConfirmPlan ? (
                  <div className="rounded-lg border border-warning/40 bg-warning/10 p-3 space-y-2" data-testid="batch-confirmation">
                    <p className="text-xs font-medium text-warning">
                      Confirm — this will run {batchConfirmPlan.steps.length} resolution
                      {batchConfirmPlan.steps.length === 1 ? '' : 's'}:
                    </p>
                    <ul className="space-y-1 max-h-40 overflow-auto">
                      {batchConfirmation.map((line) => (
                        <li key={line.path} className="text-xs">
                          <span className="font-mono text-text">{line.path.split(/[/\\]/).pop()}</span>
                          <span className="text-text-secondary">
                            {' → '}
                            {line.label} — {line.outcome}
                          </span>
                        </li>
                      ))}
                      {batchConfirmPlan.postponedPaths.length > 0 && (
                        <li className="text-xs text-text-muted">
                          {batchConfirmPlan.postponedPaths.length} conflict(s) left unresolved.
                        </li>
                      )}
                    </ul>
                    <div className="flex items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setBatchConfirmPlan(null)}
                        disabled={isProcessing}
                        className="btn btn-secondary btn-sm"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={() => void executeBatch(batchConfirmPlan)}
                        disabled={isProcessing || batchConfirmPlan.steps.length === 0}
                        className="btn btn-primary btn-sm"
                      >
                        {isProcessing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                        Resolve {batchConfirmPlan.steps.length}
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={handleReviewBatch}
                    disabled={isProcessing || unresolvedForBatch.length === 0}
                    className="btn btn-secondary w-full"
                  >
                    <List className="w-4 h-4" />
                    Review batch for {unresolvedForBatch.length} conflict
                    {unresolvedForBatch.length === 1 ? '' : 's'}…
                  </button>
                )}

                {batchError && (
                  <div className="mt-2 flex items-start gap-2 rounded-lg border border-error/30 bg-error/10 p-2.5 text-xs text-error">
                    <AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
                    <span>{batchError}</span>
                  </div>
                )}
              </div>

              {/* Info box */}
              <div className="bg-info/10 border border-info/30 rounded-lg p-4 max-w-lg mx-auto flex gap-3">
                <Info className="w-5 h-5 text-info flex-shrink-0 mt-0.5" />
                <div className="text-sm text-text-secondary">
                  <p className="font-medium text-text mb-1">Tip</p>
                  <p>
                    You can also resolve conflicts individually by choosing "Resolve" from the
                    context menu.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Select Step */}
          {currentStep === 'select' && (
            <div className="p-6 space-y-4">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-medium text-text">Select Conflicts to Resolve</h3>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() =>
                      setConflictFiles((prev) =>
                        prev.map((f) => ({ ...f, status: 'pending' as const }))
                      )
                    }
                    className="btn btn-secondary btn-sm"
                  >
                    Select All
                  </button>
                  <button
                    onClick={() =>
                      setConflictFiles((prev) =>
                        prev.map((f) => ({ ...f, status: 'skipped' as const }))
                      )
                    }
                    className="btn btn-secondary btn-sm"
                  >
                    Deselect All
                  </button>
                </div>
              </div>

              <div className="space-y-2 max-h-[400px] overflow-auto">
                {conflictFiles.map((file, index) => (
                  <label
                    key={file.path}
                    className={`
                      flex items-center gap-3 p-3 border rounded-lg cursor-pointer transition-fast
                      ${
                        file.status === 'pending'
                          ? 'border-border hover:border-accent/50'
                          : file.status === 'resolved'
                            ? 'border-svn-added/50 bg-svn-added/10'
                            : 'border-border opacity-50'
                      }
                    `}
                  >
                    <input
                      type="checkbox"
                      checked={file.status === 'pending'}
                      onChange={() => {
                        setConflictFiles((prev) =>
                          prev.map((f, i) =>
                            i === index
                              ? { ...f, status: f.status === 'pending' ? 'skipped' : 'pending' }
                              : f
                          )
                        );
                      }}
                      className="checkbox"
                    />
                    <FileText className="w-5 h-5 text-text-muted flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-text truncate">{file.path.split(/[/\\]/).pop()}</p>
                      <p className="text-xs text-text-faint truncate">{file.path}</p>
                    </div>
                    {file.status === 'resolved' && (
                      <span className="text-xs text-svn-added flex items-center gap-1">
                        <CheckCircle className="w-3 h-3" />
                        Resolved
                      </span>
                    )}
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* Resolve Step */}
          {currentStep === 'resolve' && currentFile && (
            <div className="p-6 space-y-4">
              {/* Progress */}
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-4">
                  <span className="text-sm text-text-secondary">
                    Conflict {currentIndex + 1} of {conflictFiles.length}
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setCurrentIndex((prev) => Math.max(0, prev - 1))}
                      disabled={currentIndex === 0}
                      className="btn-icon-sm"
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() =>
                        setCurrentIndex((prev) => Math.min(conflictFiles.length - 1, prev + 1))
                      }
                      disabled={currentIndex >= conflictFiles.length - 1}
                      className="btn-icon-sm"
                    >
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>
                <label className="flex items-center gap-2 text-sm text-text-secondary">
                  <input
                    type="checkbox"
                    checked={autoAdvance}
                    onChange={(e) => setAutoAdvance(e.target.checked)}
                    className="checkbox"
                  />
                  Auto-advance
                </label>
              </div>

              <div className="flex gap-1 overflow-x-auto rounded-lg border border-border bg-bg-secondary p-1.5">
                {conflictFiles.map((file, index) => (
                  <button
                    type="button"
                    key={file.path}
                    onClick={() => setCurrentIndex(index)}
                    className={`min-w-0 flex-1 rounded px-2 py-1.5 text-left text-[10px] transition-fast ${
                      index === currentIndex
                        ? 'bg-accent/15 text-accent'
                        : 'text-text-muted hover:bg-bg-tertiary'
                    }`}
                    title={file.path}
                  >
                    <span className="block truncate font-mono">
                      {file.path.split(/[/\\]/).pop()}
                    </span>
                    <span className="capitalize">
                      {file.status === 'skipped' ? 'deferred' : file.status}
                    </span>
                  </button>
                ))}
              </div>

              {/* Current file info */}
              <div className="bg-warning/10 border border-warning/30 rounded-lg p-4">
                <div className="flex items-start gap-3">
                  <FileText className="w-6 h-6 text-warning mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-text">{currentFile.path.split(/[/\\]/).pop()}</p>
                      <span
                        className="rounded bg-warning/20 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-warning"
                        data-testid="conflict-kind-badge"
                      >
                        {currentKind} conflict
                      </span>
                    </div>
                    <p className="text-xs text-text-faint truncate">{currentFile.path}</p>
                    <p className="text-sm text-text-secondary mt-2">{KIND_DESCRIPTIONS[currentKind]}</p>
                  </div>
                </div>
              </div>

              {/* AI conflict explainer (#111): lazy, consent-gated, cancellable */}
              <ConflictAiExplainer
                key={currentFile.path}
                workingCopyPath={workingCopyPath}
                filePath={currentFile.path}
                loadContents={async () => {
                  const contents = await loadMergeEditorContents(currentFile.path);
                  return {
                    ...contents,
                    fingerprint: conflictSourceFingerprint(contents),
                  };
                }}
                onProposalMetadata={(metadata) => {
                  setConflictFiles((previous) =>
                    previous.map((file, index) =>
                      index === currentIndex
                        ? {
                            ...file,
                            proposal: metadata,
                            proposalStale: false,
                          }
                        : file
                    )
                  );
                }}
              />

              {currentFile.proposalStale && (
                <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 p-3 text-xs text-warning">
                  <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                  Base, mine, or theirs changed after the saved proposal. Generate a fresh proposal
                  before relying on it.
                </div>
              )}

              {currentFile.proposal && (
                <div className="rounded-lg border border-border bg-bg-secondary p-3 text-xs text-text-secondary">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-text">Proposal metadata</span>
                    <span>{Math.round(currentFile.proposal.confidence * 100)}% confidence</span>
                  </div>
                  {currentFile.proposal.unresolvedQuestions.length > 0 && (
                    <ul className="mt-2 list-disc space-y-1 pl-4 text-warning">
                      {currentFile.proposal.unresolvedQuestions.map((question) => (
                        <li key={question}>{question}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              {/* Property-conflict flow (#56): mine/theirs/base values + merge editor */}
              {currentKind === 'property' && (
                <PropertyConflictPanel
                  conflictPath={currentFile.path}
                  isProcessing={isProcessing}
                  onPropertiesApplied={() => handleResolve('working')}
                />
              )}

              {/* Binary-conflict flow (#56): metadata + explicit choice + external tool */}
              {currentKind === 'binary' && (
                <BinaryConflictPanel
                  conflictPath={currentFile.path}
                  isProcessing={isProcessing}
                  externalMergeTool={externalMergeTool}
                  isLaunchingExternalTool={isLaunchingExternalTool}
                  onOpenExternalMergeTool={handleOpenExternalMergeTool}
                  onResolve={(mode) => handleResolve(mode)}
                />
              )}

              {/* Version previews + quick compare (#55) */}
              {currentKind === 'text' && (
                <div className="rounded-lg border border-border bg-bg-secondary p-3 space-y-3" data-testid="conflict-preview">
                  <div className="flex items-center justify-between gap-2">
                    <h5 className="text-xs font-medium text-text">Preview versions</h5>
                    <div className="flex items-center gap-1">
                      {(['mine', 'theirs', 'base', 'merged'] as PreviewSide[]).map((side) => (
                        <button
                          key={side}
                          type="button"
                          onClick={() => void handlePreview(side)}
                          disabled={previewLoading}
                          className={`btn btn-sm text-xs capitalize ${
                            previewSide === side ? 'btn-primary' : 'btn-secondary'
                          }`}
                        >
                          {side}
                        </button>
                      ))}
                      <button
                        type="button"
                        onClick={() => void handleQuickCompare()}
                        disabled={quickCompareLoading}
                        className="btn btn-secondary btn-sm text-xs"
                        aria-label="Compare mine vs theirs"
                      >
                        {quickCompareLoading ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Columns2 className="w-3.5 h-3.5" />
                        )}
                        Compare
                      </button>
                    </div>
                  </div>

                  {previewLoading && (
                    <div className="flex items-center gap-2 text-xs text-text-muted">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      Loading {previewSide} version…
                    </div>
                  )}
                  {previewError && (
                    <div className="flex items-start gap-2 rounded border border-error/30 bg-error/10 p-2 text-xs text-error">
                      <AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
                      <span>{previewError}</span>
                    </div>
                  )}
                  {previewSide && !previewLoading && !previewError && (
                    <div>
                      <p className="mb-1 text-[10px] uppercase tracking-wide text-text-faint">
                        {previewSide === 'base'
                          ? 'Base — the common ancestor'
                          : previewSide === 'mine'
                            ? 'Mine — your local changes'
                            : previewSide === 'theirs'
                              ? 'Theirs — the incoming version'
                              : 'Merged — the working file with conflict markers'}
                      </p>
                      {previewBinary ? (
                        <p className="rounded border border-border bg-bg-tertiary p-3 text-xs text-text-secondary">
                          Binary content — {previewContent?.length ?? 0} bytes. Use the quick
                          compare summary or an external tool instead.
                        </p>
                      ) : (
                        <pre className="max-h-48 overflow-auto rounded border border-border bg-bg-tertiary p-3 font-mono text-[11px] leading-relaxed text-text whitespace-pre-wrap break-all">
                          {previewContent}
                        </pre>
                      )}
                    </div>
                  )}

                  {quickCompareError && (
                    <div className="flex items-start gap-2 rounded border border-error/30 bg-error/10 p-2 text-xs text-error">
                      <AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
                      <span>{quickCompareError}</span>
                    </div>
                  )}
                  {quickCompare && (
                    <div>
                      <p className="mb-1 text-[10px] uppercase tracking-wide text-text-faint">
                        Mine vs theirs — {quickCompareSummary}
                      </p>
                      <div className="max-h-72 overflow-hidden rounded border border-border bg-bg-tertiary">
                        <VirtualizedDiffViewer
                          diff={quickCompare}
                          viewMode="side-by-side"
                          showToolbar={false}
                          showFileHeaders={false}
                          estimatedRowHeight={20}
                        />
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Resolution options */}
              <div className="space-y-3">
                <h4 className="text-sm font-medium text-text">Choose Resolution</h4>

                <div className="grid grid-cols-2 gap-3">
                  {primaryModes.map((mode) => (
                    <button
                      key={mode.value}
                      onClick={() => handleResolve(mode.value)}
                      disabled={isProcessing}
                      className="btn btn-secondary h-auto py-3 flex-col items-start"
                    >
                      <span className="font-medium">
                        {mode.value === 'mine-full' ? 'Use Mine' : 'Use Theirs'}
                      </span>
                      <span className="text-xs text-text-muted">{mode.outcome}</span>
                    </button>
                  ))}
                </div>

                {/* Every other applicable svn resolve mode (#55) */}
                {advancedModes.length > 0 && (
                  <div className="space-y-1.5">
                    <p className="text-xs font-medium text-text-secondary">More resolution options</p>
                    {advancedModes.map((mode) => (
                      <button
                        key={mode.value}
                        type="button"
                        onClick={() => handleResolve(mode.value)}
                        disabled={isProcessing}
                        aria-label={mode.label}
                        className="w-full flex items-start justify-between gap-3 rounded-lg border border-border bg-bg-secondary p-2.5 text-left transition-fast hover:border-accent/50 disabled:opacity-50"
                      >
                        <span className="min-w-0">
                          <span className="block text-sm font-medium text-text">{mode.label}</span>
                          <span className="block text-xs text-text-secondary">{mode.consequence}</span>
                        </span>
                        {mode.destructive && (
                          <span className="mt-0.5 flex-shrink-0 rounded bg-warning/15 px-1.5 py-0.5 text-[10px] font-medium text-warning">
                            discards changes
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                )}

                {/* External merge tool option */}
                {hasExternalMergeTool && currentKind !== 'property' && currentKind !== 'tree' && (
                  <div className="bg-bg-tertiary rounded-lg p-3">
                    <h5 className="text-sm font-medium text-text mb-2">External Merge Tool</h5>
                    <p className="text-xs text-text-secondary mb-3">
                      Launch {externalMergeTool} to visually resolve conflicts.
                    </p>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={handleOpenExternalMergeTool}
                        disabled={isLaunchingExternalTool || isProcessing}
                        className="btn btn-primary btn-sm"
                      >
                        {isLaunchingExternalTool ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Wrench className="w-4 h-4" />
                        )}
                        Edit Conflicts
                      </button>
                      <button
                        onClick={handleMarkResolvedAfterExternal}
                        disabled={isProcessing}
                        className="btn btn-secondary btn-sm"
                      >
                        <CheckCircle className="w-4 h-4" />
                        Mark as Resolved
                      </button>
                    </div>
                    <p className="text-xs text-text-faint mt-2">
                      After resolving in the external tool, click "Mark as Resolved"
                    </p>
                  </div>
                )}

                {/* Built-in merge option */}
                {currentKind === 'text' && (
                  <button
                    onClick={handleOpenMergeEditor}
                    disabled={isLoadingMergeEditor}
                    className="btn btn-secondary w-full"
                  >
                    {isLoadingMergeEditor ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Eye className="w-4 h-4" />
                    )}
                    Open Built-in Merge Editor
                    <span className="text-xs text-text-muted">Save &amp; continue</span>
                  </button>
                )}

                <div className="grid grid-cols-2 gap-2">
                  <button onClick={handleDefer} className="btn btn-ghost text-text-muted">
                    Defer
                  </button>
                  <button
                    onClick={handleNextUnresolved}
                    disabled={conflictFiles.every(
                      (file, index) => index === currentIndex || file.status === 'resolved'
                    )}
                    className="btn btn-secondary"
                  >
                    Next unresolved
                  </button>
                </div>
              </div>

              {/* External tool error */}
              {externalToolError && (
                <div className="bg-error/10 border border-error/30 rounded-lg p-3 flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-error mt-0.5" />
                  <div className="text-sm text-error">{externalToolError}</div>
                </div>
              )}

              {mergeEditorError && (
                <div className="bg-error/10 border border-error/30 rounded-lg p-3 flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-error mt-0.5" />
                  <div className="text-sm text-error">{mergeEditorError}</div>
                </div>
              )}

              {/* Error display */}
              {currentFile.error && (
                <div className="bg-error/10 border border-error/30 rounded-lg p-3 flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-error mt-0.5" />
                  <div className="text-sm text-error">{currentFile.error}</div>
                </div>
              )}
            </div>
          )}

          {/* Review Step */}
          {currentStep === 'review' && (
            <div className="p-6 space-y-4">
              <h3 className="text-lg font-medium text-text mb-4">Review Resolutions</h3>

              <div className="space-y-2 max-h-[400px] overflow-auto">
                {conflictFiles.map((file, index) => (
                  <div
                    key={file.path}
                    className={`
                      flex items-center gap-3 p-3 border rounded-lg
                      ${
                        file.status === 'resolved'
                          ? 'border-svn-added/50 bg-svn-added/10'
                          : file.status === 'skipped'
                            ? 'border-border bg-bg-tertiary opacity-60'
                            : 'border-warning/50 bg-warning/10'
                      }
                    `}
                  >
                    <FileText className="w-5 h-5 text-text-muted flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-text truncate">{file.path.split(/[/\\]/).pop()}</p>
                      <p className="text-xs text-text-faint truncate">
                        {file.path}
                        {file.resolution
                          ? ` — ${acceptModeOutcome(normalizeWizardResolution(file.resolution))}`
                          : ''}
                      </p>
                    </div>
                    {file.status === 'resolved' && (
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-svn-added flex items-center gap-1">
                          <CheckCircle className="w-3 h-3" />
                          {file.resolution
                            ? acceptModeLabel(normalizeWizardResolution(file.resolution))
                            : 'resolved'}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleReopen(index)}
                          className="btn btn-secondary btn-sm text-xs"
                        >
                          Reopen
                        </button>
                      </div>
                    )}
                    {file.status === 'skipped' && (
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-text-muted">Deferred</span>
                        <button
                          type="button"
                          onClick={() => handleReopen(index)}
                          className="btn btn-secondary btn-sm text-xs"
                        >
                          Resume
                        </button>
                      </div>
                    )}
                    {file.status === 'pending' && (
                      <span className="text-xs text-warning">Pending</span>
                    )}
                  </div>
                ))}
              </div>

              {/* Summary */}
              <div className="bg-bg-tertiary rounded-lg p-4">
                <div className="grid grid-cols-3 gap-4 text-center">
                  <div>
                    <p className="text-2xl font-bold text-svn-added">{stats.resolved}</p>
                    <p className="text-xs text-text-muted">Resolved</p>
                  </div>
                  <div>
                    <p className="text-2xl font-bold text-warning">{stats.pending}</p>
                    <p className="text-xs text-text-muted">Pending</p>
                  </div>
                  <div>
                    <p className="text-2xl font-bold text-text-muted">{stats.skipped}</p>
                    <p className="text-xs text-text-muted">Skipped</p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Complete Step */}
          {currentStep === 'complete' && (
            <div className="p-6">
              <div className="text-center py-12">
                <div className="w-16 h-16 rounded-full bg-svn-added/20 flex items-center justify-center mx-auto mb-4">
                  <CheckCircle className="w-8 h-8 text-svn-added" />
                </div>
                <h3 className="text-xl font-medium text-text mb-2">All Conflicts Resolved!</h3>
                <p className="text-text-secondary max-w-md mx-auto mb-6">
                  You have successfully resolved all conflicts. You can now commit your changes.
                </p>
                <button onClick={handleFinish} className="btn btn-primary">
                  <CheckCircle className="w-4 h-4" />
                  Finish
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex-shrink-0 px-6 py-4 bg-bg-secondary border-t border-border flex items-center justify-between">
          <button
            onClick={goToPrevStep}
            disabled={currentStep === 'overview'}
            className="btn btn-secondary"
          >
            <ChevronLeft className="w-4 h-4" />
            Back
          </button>

          <div className="flex items-center gap-2">
            {currentStep !== 'complete' && (
              <button
                onClick={goToNextStep}
                disabled={currentStep === 'resolve' || stats.pending === 0}
                className="btn btn-primary"
              >
                Next
                <ChevronRight className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {/* Merge Editor Overlay */}
        {showMergeEditor && currentFile && mergeEditorContents && (
          <ThreeWayMergeEditor
            isOpen={showMergeEditor}
            filePath={currentFile.path}
            mineContent={mergeEditorContents.mineContent}
            theirsContent={mergeEditorContents.theirsContent}
            baseContent={mergeEditorContents.baseContent}
            mergedContent={mergeEditorContents.mergedContent}
            onClose={() => setShowMergeEditor(false)}
            onSave={handleMergeEditorSave}
            onProposalMetadata={(metadata) => {
              setConflictFiles((previous) =>
                previous.map((file, index) =>
                  index === currentIndex
                    ? {
                        ...file,
                        proposal: {
                          ...metadata,
                          sourceFingerprint: file.sourceFingerprint ?? '',
                        },
                        proposalStale: false,
                      }
                    : file
                )
              );
            }}
          />
        )}
      </>
    </DialogBase>
  );
}

export default ConflictResolutionWizard;
