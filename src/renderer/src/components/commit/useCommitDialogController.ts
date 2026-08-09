import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useCommitMessageHistory } from '@renderer/hooks/useCommitMessageHistory';
import { setTemplateContext, useCommitTemplates } from '@renderer/hooks/useCommitTemplates';
import { useCommitRules } from '@renderer/hooks/useCommitRules';
import { useFocusTrap } from '@renderer/hooks/useFocusTrap';
import { useIssueTrackerConfig } from '@renderer/hooks/useIssueTrackerConfig';
import { useSettings } from '@renderer/hooks/useSettings';
import {
  captureReviewCenterResult,
  checksumReviewInput,
} from '@renderer/features/ai-review-center/reviewCenterEvents';
import { buildPathAutocompleteOptions } from '@renderer/utils/commitAutocomplete';
import { getCommitWarnings } from '@renderer/utils/commitWarnings';
import { validateCommitRules } from '@renderer/utils/commitRules';
import { extractIssueLinks } from '@renderer/utils/issueTracker';
import { assertSuccessfulSvnRead } from '@renderer/utils/svnReadResult';
import type { CommitSuggestion, TemplateRecommendation } from '@renderer/utils/suggestionEngine';
import type {
  AiCommitPlanResult,
  AiCommitReviewResult,
  AiDiffExplanationMode,
  AiDiffExplanationResult,
  AiCommitMessageResult,
  AiCommitProviderStatus,
  AiDraftTransformation,
  AiPromptPreviewResult,
  FsStatusResult,
  SvnStatusChar,
  SvnStatusEntry,
} from '@shared/types';
import type { AutocompleteOption } from '../ui/AutoCompleteInput';
import type { DiffViewMode } from '../ui/EnhancedDiffViewer';

export interface CommitFile {
  path: string;
  status: SvnStatusChar;
  isDirectory: boolean;
  selected: boolean;
  committable: boolean;
  propsStatus?: SvnStatusChar;
  revision?: number;
  changelist?: string;
  switched?: boolean;
  lock?: {
    owner: string;
    comment: string;
    date: string;
  };
}

type CommitDialogSubmit = (
  paths: string[],
  message: string
) => Promise<{ success: boolean; message?: string; revision?: number }>;

interface UseCommitDialogControllerOptions {
  isOpen: boolean;
  workingCopyPath: string;
  onClose: () => void;
  onSubmit: CommitDialogSubmit;
}

const COMMITABLE_STATUSES: SvnStatusChar[] = ['M', 'A', 'D', 'R', '?'];
const DISPLAY_ONLY_STATUSES: SvnStatusChar[] = ['C', '!', '~', 'X'];
const COMMIT_MESSAGE_PREFIXES = [
  'feat: ',
  'fix: ',
  'refactor: ',
  'docs: ',
  'test: ',
  'chore: ',
  'style: ',
  'perf: ',
];
const ALL_DRAFT_TRANSFORMATIONS: AiDraftTransformation[] = [
  'shorter',
  'add-body',
  'remove-body',
  'imperative',
  'match-style',
  'include-issues',
  'explain-motivation',
  'regenerate',
];

function canCommitStatus(status: SvnStatusChar, propsStatus?: SvnStatusChar): boolean {
  return (
    COMMITABLE_STATUSES.includes(status) ||
    (propsStatus !== undefined && COMMITABLE_STATUSES.includes(propsStatus))
  );
}

const openIssue = (url?: string) => {
  if (!url) return;
  void window.api.app.openExternal(url);
};

function deepStatusToEntries(deepStatus?: FsStatusResult): SvnStatusEntry[] {
  if (!deepStatus?.allEntries.length) return [];

  return deepStatus.allEntries.map((entry) => ({
    path: entry.fullPath,
    status: entry.status,
    revision: entry.revision,
    author: entry.author,
    isDirectory: false,
  }));
}

export function useCommitDialogController({
  isOpen,
  workingCopyPath,
  onClose,
  onSubmit,
}: UseCommitDialogControllerOptions) {
  const [message, setMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ revision: number } | null>(null);
  const [selectedDiffFile, setSelectedDiffFile] = useState<string | null>(null);
  const [showTemplates, setShowTemplates] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showTemplateManager, setShowTemplateManager] = useState(false);
  const [fileFilter, setFileFilter] = useState<
    'all' | 'modified' | 'added' | 'deleted' | 'changelist' | 'external'
  >('all');
  const [diffViewMode, setDiffViewMode] = useState<DiffViewMode>('unified');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [showRules, setShowRules] = useState(false);
  const [validationWarnings, setValidationWarnings] = useState<string[]>([]);
  const [files, setFiles] = useState<CommitFile[]>([]);
  const [aiSuggestions, setAiSuggestions] = useState<CommitSuggestion[]>([]);
  const [templateRecommendations, setTemplateRecommendations] = useState<TemplateRecommendation[]>(
    []
  );
  const [keywordSuggestions, setKeywordSuggestions] = useState<string[]>([]);
  const [isGeneratingMessage, setIsGeneratingMessage] = useState(false);
  const [showAiConsent, setShowAiConsent] = useState(false);
  const [aiPromptPreview, setAiPromptPreview] = useState<AiPromptPreviewResult | null>(null);
  const [isPreparingAiPrompt, setIsPreparingAiPrompt] = useState(false);
  const [pendingAiAction, setPendingAiAction] = useState<
    'draft' | 'review' | 'plan' | 'explain' | 'transform' | null
  >(null);
  const [pendingDraftTransformation, setPendingDraftTransformation] =
    useState<AiDraftTransformation | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiGenerationNotice, setAiGenerationNotice] = useState<string | null>(null);
  const [aiReview, setAiReview] = useState<AiCommitReviewResult | null>(null);
  const [aiCommitPlan, setAiCommitPlan] = useState<AiCommitPlanResult | null>(null);
  const [aiDiffExplanation, setAiDiffExplanation] = useState<AiDiffExplanationResult | null>(null);
  const [aiExplanationMode, setAiExplanationMode] = useState<AiDiffExplanationMode>('summary');
  const [isRunningAiAssistant, setIsRunningAiAssistant] = useState(false);
  const deferredMessage = useDeferredValue(message);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const submissionInFlightRef = useRef(false);
  const selectionScopeRef = useRef<string | null>(null);
  const defaultMessageInitializedRef = useRef(false);
  const generationEpochRef = useRef(0);
  const activeGenerationRef = useRef<{
    operationId: string;
    controller: AbortController;
    selectionFingerprint: string;
    initialMessage: string;
  } | null>(null);
  const activeAssistantRef = useRef<{
    operationId: string;
    controller: AbortController;
    selectionFingerprint: string;
  } | null>(null);
  const messageRef = useRef(message);
  messageRef.current = message;
  const { settings, isLoading: isLoadingSettings, updateSettings } = useSettings();
  const { history, addMessage } = useCommitMessageHistory();
  const { templates, applyTemplate } = useCommitTemplates();
  const issueTrackerLookupPath = workingCopyPath;
  const { config: issueTrackerConfig, updateConfig: updateIssueTrackerConfig } =
    useIssueTrackerConfig(workingCopyPath, issueTrackerLookupPath);
  const { rules, updateRules } = useCommitRules(workingCopyPath, issueTrackerConfig);

  const cancelMessageGeneration = useCallback(() => {
    generationEpochRef.current += 1;
    const active = activeGenerationRef.current;
    activeGenerationRef.current = null;
    if (active) {
      active.controller.abort();
      void window.api.ai.cancel(active.operationId).catch(() => undefined);
    }
    setIsGeneratingMessage(false);
  }, []);

  const cancelAiAssistant = useCallback(() => {
    const active = activeAssistantRef.current;
    activeAssistantRef.current = null;
    if (active) {
      active.controller.abort();
      void window.api.ai.cancel(active.operationId).catch(() => undefined);
    }
    setIsRunningAiAssistant(false);
  }, []);

  const modalRef = useFocusTrap({
    active: isOpen && !success,
    onEscape: () => {
      if (!isSubmitting) onClose();
    },
    initialFocus: textareaRef,
    returnFocus: true,
    allowOutsideClick: true,
  });

  const dialogId = useMemo(() => `commit-dialog-${Math.random().toString(36).slice(2, 11)}`, []);
  const titleId = `${dialogId}-title`;
  const descriptionId = `${dialogId}-description`;

  const {
    data: statusData,
    isLoading: isLoadingSvnStatus,
    refetch,
  } = useQuery({
    queryKey: ['svn:status', workingCopyPath],
    queryFn: async ({ signal }) =>
      assertSuccessfulSvnRead(await window.api.svn.status(workingCopyPath, { signal })),
    enabled: isOpen && !!workingCopyPath,
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
  });

  const {
    data: deepStatusData,
    isLoading: isLoadingDeepStatus,
    refetch: refetchDeepStatus,
  } = useQuery({
    queryKey: ['fs:getDeepStatus', workingCopyPath],
    queryFn: () => window.api.fs.getDeepStatus(workingCopyPath),
    enabled: isOpen && !!workingCopyPath,
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
  });

  const statusEntries = useMemo(
    () => (statusData?.entries?.length ? statusData.entries : deepStatusToEntries(deepStatusData)),
    [deepStatusData, statusData?.entries]
  );
  const isLoadingStatus = isLoadingSvnStatus || (statusEntries.length === 0 && isLoadingDeepStatus);

  useEffect(() => {
    if (statusEntries.length > 0) {
      const commitFiles = statusEntries
        .filter(
          (entry) =>
            canCommitStatus(entry.status, entry.propsStatus) ||
            DISPLAY_ONLY_STATUSES.includes(entry.status)
        )
        .map((entry) => {
          const committable = canCommitStatus(entry.status, entry.propsStatus);
          return {
            path: entry.path,
            status: entry.status,
            isDirectory: entry.isDirectory,
            committable,
            propsStatus: entry.propsStatus,
            revision: entry.revision,
            changelist: entry.changelist,
            switched: entry.switched,
            lock: entry.lock,
            selected: committable && entry.status !== '?',
          };
        });
      setFiles((previous) => {
        const sameScope = selectionScopeRef.current === workingCopyPath;
        selectionScopeRef.current = workingCopyPath;
        if (!sameScope) return commitFiles;
        const previousByPath = new Map(previous.map((file) => [file.path, file]));
        return commitFiles.map((file) => {
          const existing = previousByPath.get(file.path);
          return existing ? { ...file, selected: file.committable && existing.selected } : file;
        });
      });
    } else if (isOpen) {
      setFiles([]);
    }
  }, [isOpen, statusEntries, workingCopyPath]);

  const selectedFileSummaries = useMemo(
    () =>
      files
        .filter((file) => file.selected)
        .map((file) => ({
          path: file.path,
          status: file.status,
        })),
    [files]
  );

  useEffect(() => {
    if (!showSuggestions || selectedFileSummaries.length === 0) {
      setAiSuggestions([]);
      return;
    }

    let cancelled = false;
    void import('@renderer/utils/suggestionEngine').then(({ analyzeFiles }) => {
      if (!cancelled) {
        setAiSuggestions(analyzeFiles(selectedFileSummaries).suggestions);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [selectedFileSummaries, showSuggestions]);

  useEffect(() => {
    if (!showTemplates || selectedFileSummaries.length === 0) {
      setTemplateRecommendations([]);
      return;
    }

    let cancelled = false;
    void import('@renderer/utils/suggestionEngine').then(({ getTemplatesWithRecommendations }) => {
      if (!cancelled) {
        setTemplateRecommendations(getTemplatesWithRecommendations(selectedFileSummaries));
      }
    });

    return () => {
      cancelled = true;
    };
  }, [selectedFileSummaries, showTemplates]);

  useEffect(() => {
    if (!deferredMessage.trim()) {
      setKeywordSuggestions(COMMIT_MESSAGE_PREFIXES);
      return;
    }

    let cancelled = false;
    void import('@renderer/utils/suggestionEngine').then(({ getAutocompleteSuggestions }) => {
      if (!cancelled) {
        setKeywordSuggestions(
          getAutocompleteSuggestions(
            deferredMessage,
            selectedFileSummaries,
            history.map((historyItem) => historyItem.message)
          )
        );
      }
    });

    return () => {
      cancelled = true;
    };
  }, [deferredMessage, history, selectedFileSummaries]);

  const autocompleteOptions = useMemo((): AutocompleteOption[] => {
    const options: AutocompleteOption[] = [];

    for (const suggestion of keywordSuggestions.slice(0, 5)) {
      options.push({
        value: suggestion,
        label: suggestion,
        description: 'Commit keyword',
        category: 'Keywords',
      });
    }

    options.push(...buildPathAutocompleteOptions(deferredMessage, selectedFileSummaries));

    for (const historyItem of history.slice(0, 5)) {
      options.push({
        value: historyItem.message,
        label: historyItem.message.slice(0, 50) + (historyItem.message.length > 50 ? '...' : ''),
        description: new Date(historyItem.timestamp).toLocaleDateString(),
        category: 'Recent',
      });
    }

    const seenValues = new Set<string>();
    return options.filter((option) => {
      if (seenValues.has(option.value)) return false;
      seenValues.add(option.value);
      return true;
    });
  }, [deferredMessage, history, keywordSuggestions, selectedFileSummaries]);

  const { data: diffData } = useQuery({
    queryKey: ['svn:diff', selectedDiffFile],
    queryFn: ({ signal }) => window.api.svn.diff(selectedDiffFile!, undefined, { signal }),
    enabled: !!selectedDiffFile,
  });

  const filteredFiles = useMemo(() => {
    if (fileFilter === 'all') return files;
    if (fileFilter === 'changelist') return files.filter((file) => file.changelist);
    const filterMap: Record<Exclude<typeof fileFilter, 'all' | 'changelist'>, SvnStatusChar[]> = {
      modified: ['M', 'R'],
      added: ['A', '?'],
      deleted: ['D', '!'],
      external: ['X'],
    };
    return files.filter((file) => filterMap[fileFilter]?.includes(file.status));
  }, [files, fileFilter]);

  const selectedFiles = useMemo(
    () => files.filter((file) => file.selected && file.committable),
    [files]
  );
  const selectedCount = selectedFiles.length;
  const selectionFingerprint = useMemo(
    () =>
      selectedFiles
        .map((file) => `${file.status}:${file.path}`)
        .toSorted()
        .join('\n'),
    [selectedFiles]
  );
  const committableCount = useMemo(() => files.filter((file) => file.committable).length, [files]);
  const commitWarnings = useMemo(
    () => getCommitWarnings(files, statusEntries.length > 0 ? statusEntries : files),
    [files, statusEntries]
  );
  const ruleErrors = useMemo(
    () => (message.trim() ? validateCommitRules(message, rules) : []),
    [message, rules]
  );
  const issueLinks = useMemo(
    () => extractIssueLinks(message, issueTrackerConfig),
    [message, issueTrackerConfig]
  );

  useEffect(() => {
    if (isOpen) {
      setMessage('');
      setError(null);
      setSuccess(null);
      setIsSubmitting(false);
      setSelectedDiffFile(null);
      setShowTemplates(false);
      setShowHistory(false);
      setShowTemplateManager(false);
      setShowRules(false);
      setFileFilter('all');
      setDiffViewMode('unified');
      setShowSuggestions(false);
      setShowAiConsent(false);
      setAiError(null);
      setAiGenerationNotice(null);
      setAiReview(null);
      setAiCommitPlan(null);
      setAiDiffExplanation(null);
      setValidationWarnings([]);
      setTimeout(() => textareaRef.current?.focus(), 100);
    } else {
      defaultMessageInitializedRef.current = false;
      cancelMessageGeneration();
      cancelAiAssistant();
    }
  }, [cancelAiAssistant, cancelMessageGeneration, isOpen]);

  useEffect(() => {
    if (!isOpen || isLoadingSettings || defaultMessageInitializedRef.current) return;
    defaultMessageInitializedRef.current = true;
    setMessage(settings.defaultCommitMessage);
  }, [isLoadingSettings, isOpen, settings.defaultCommitMessage]);

  useEffect(() => {
    const active = activeGenerationRef.current;
    if (active && active.selectionFingerprint !== selectionFingerprint) {
      cancelMessageGeneration();
      setAiError('Generation cancelled because the selected files changed.');
    }
    const assistant = activeAssistantRef.current;
    if (assistant && assistant.selectionFingerprint !== selectionFingerprint) {
      cancelAiAssistant();
      setAiError('AI analysis cancelled because the selected files changed.');
    }
    setAiReview(null);
    setAiCommitPlan(null);
  }, [cancelAiAssistant, cancelMessageGeneration, selectionFingerprint]);

  const { data: aiProviders = [], isLoading: isLoadingAiProviders } = useQuery({
    queryKey: ['ai:providers'],
    queryFn: () => window.api.ai.providers(),
    enabled: isOpen && settings.aiCommit.enabled,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });

  const { data: repositoryAiProfile } = useQuery({
    queryKey: ['ai:repository-profile', workingCopyPath],
    queryFn: () => window.api.ai.repositoryProfile.get(workingCopyPath),
    enabled: isOpen && !!workingCopyPath,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
  const enabledDraftTransformations =
    repositoryAiProfile?.enabledDraftTransformations ?? ALL_DRAFT_TRANSFORMATIONS;

  const selectedAiProvider = useMemo((): AiCommitProviderStatus | undefined => {
    if (settings.aiCommit.provider === 'auto') {
      return aiProviders.find((provider) => provider.available && provider.authenticated !== false);
    }
    return aiProviders.find((provider) => provider.provider === settings.aiCommit.provider);
  }, [aiProviders, settings.aiCommit.provider]);

  const aiProviderAvailable =
    settings.aiCommit.enabled &&
    selectedAiProvider?.available === true &&
    selectedAiProvider.authenticated !== false;

  const runMessageGeneration = useCallback(async () => {
    if (!settings.aiCommit.enabled) {
      setAiError('Commit message generation is disabled in Settings.');
      return;
    }
    if (!aiProviderAvailable) {
      setAiError(selectedAiProvider?.reason || 'No configured AI CLI is available.');
      return;
    }
    if (selectedFiles.length === 0) {
      setAiError('Select at least one file before generating a commit message.');
      return;
    }

    cancelMessageGeneration();
    const epoch = generationEpochRef.current;
    const controller = new AbortController();
    const operationId = window.crypto.randomUUID();
    const initialMessage = messageRef.current;
    const requestFingerprint = selectionFingerprint;
    activeGenerationRef.current = {
      operationId,
      controller,
      selectionFingerprint: requestFingerprint,
      initialMessage,
    };
    setShowAiConsent(false);
    setAiError(null);
    setAiGenerationNotice(null);
    setIsGeneratingMessage(true);

    try {
      const result: AiCommitMessageResult = await window.api.ai.generateCommitMessage(
        {
          operationId,
          workingCopyPath,
          paths: selectedFiles.map((file) => file.path),
          ...(initialMessage.trim() ? { existingMessage: initialMessage } : {}),
        },
        { signal: controller.signal }
      );
      const active = activeGenerationRef.current;
      if (
        generationEpochRef.current !== epoch ||
        active?.operationId !== operationId ||
        active.selectionFingerprint !== requestFingerprint ||
        messageRef.current !== initialMessage
      ) {
        return;
      }

      activeGenerationRef.current = null;
      setIsGeneratingMessage(false);
      setMessage(result.message);
      textareaRef.current?.focus();

      const notes: string[] = [];
      if (result.diffTruncated) notes.push('the diff was truncated');
      if (result.omittedBinaryFiles.length > 0) {
        notes.push(
          `${result.omittedBinaryFiles.length} binary file${result.omittedBinaryFiles.length === 1 ? ' was' : 's were'} omitted`
        );
      }
      if (result.redacted) notes.push('possible secrets were redacted');
      const providerLabel = result.model ? `${result.provider} (${result.model})` : result.provider;
      setAiGenerationNotice(
        notes.length > 0
          ? `Generated with ${providerLabel}. Note: ${notes.join('; ')}.`
          : `Generated with ${providerLabel}. Review and edit before committing.`
      );
    } catch (generationError) {
      if (generationEpochRef.current !== epoch || controller.signal.aborted) return;
      activeGenerationRef.current = null;
      setIsGeneratingMessage(false);
      setAiError(
        generationError instanceof Error
          ? generationError.message
          : 'Failed to generate a commit message.'
      );
    }
  }, [
    aiProviderAvailable,
    cancelMessageGeneration,
    selectedAiProvider?.reason,
    selectedFiles,
    selectionFingerprint,
    settings.aiCommit.enabled,
    workingCopyPath,
  ]);

  const handleGenerateMessage = () => {
    if (settings.aiCommit.confirmBeforeSending) {
      void prepareAiConsent('draft');
      return;
    }
    void runMessageGeneration();
  };

  const handleMessageChange = (nextMessage: string) => {
    if (activeGenerationRef.current) cancelMessageGeneration();
    setMessage(nextMessage);
  };

  const runDraftTransformation = useCallback(
    async (transformation: AiDraftTransformation) => {
      if (!messageRef.current.trim()) {
        setAiError('Write or generate a draft before transforming it.');
        return;
      }
      if (!aiProviderAvailable || selectedFiles.length === 0) {
        setAiError(selectedAiProvider?.reason || 'Select files and configure an AI provider.');
        return;
      }
      cancelMessageGeneration();
      const epoch = generationEpochRef.current;
      const controller = new AbortController();
      const operationId = window.crypto.randomUUID();
      const initialMessage = messageRef.current;
      const requestFingerprint = selectionFingerprint;
      activeGenerationRef.current = {
        operationId,
        controller,
        selectionFingerprint: requestFingerprint,
        initialMessage,
      };
      setShowAiConsent(false);
      setAiError(null);
      setAiGenerationNotice(null);
      setIsGeneratingMessage(true);
      try {
        const result = await window.api.ai.transformDraft(
          {
            operationId,
            workingCopyPath,
            paths: selectedFiles.map((file) => file.path),
            currentDraft: initialMessage,
            transformation,
          },
          { signal: controller.signal }
        );
        const active = activeGenerationRef.current;
        if (
          generationEpochRef.current !== epoch ||
          active?.operationId !== operationId ||
          active.selectionFingerprint !== requestFingerprint ||
          messageRef.current !== initialMessage
        )
          return;
        activeGenerationRef.current = null;
        setIsGeneratingMessage(false);
        setMessage(result.message);
        textareaRef.current?.focus();
        const provider = result.model ? `${result.provider} (${result.model})` : result.provider;
        setAiGenerationNotice(
          `Transformed with ${provider} in ${(result.durationMs / 1000).toFixed(1)}s. Review and edit before committing.`
        );
      } catch (transformationError) {
        if (generationEpochRef.current !== epoch || controller.signal.aborted) return;
        activeGenerationRef.current = null;
        setIsGeneratingMessage(false);
        setAiError(
          transformationError instanceof Error
            ? transformationError.message
            : 'Draft transformation failed.'
        );
      }
    },
    [
      aiProviderAvailable,
      cancelMessageGeneration,
      selectedAiProvider?.reason,
      selectedFiles,
      selectionFingerprint,
      workingCopyPath,
    ]
  );

  const handleTransformDraft = (transformation: AiDraftTransformation) => {
    if (!enabledDraftTransformations.includes(transformation)) return;
    if (settings.aiCommit.confirmBeforeSending) {
      setPendingDraftTransformation(transformation);
      void prepareAiConsent('transform', transformation);
    } else void runDraftTransformation(transformation);
  };

  const handleConfirmAiGeneration = async (rememberConsent: boolean) => {
    const action = pendingAiAction ?? 'draft';
    setShowAiConsent(false);
    setPendingAiAction(null);
    const transformation = pendingDraftTransformation;
    setPendingDraftTransformation(null);
    setAiPromptPreview(null);
    if (rememberConsent) {
      await updateSettings({
        aiCommit: { ...settings.aiCommit, confirmBeforeSending: false },
      });
    }
    if (action === 'draft') await runMessageGeneration();
    else if (action === 'transform' && transformation) await runDraftTransformation(transformation);
    else if (action === 'review') await runSelectedAiAnalysis('review');
    else if (action === 'plan') await runSelectedAiAnalysis('plan');
    else await handleExplainDiff();
  };

  const runSelectedAiAnalysis = useCallback(
    async (kind: 'review' | 'plan') => {
      if (!aiProviderAvailable || selectedFiles.length === 0) {
        setAiError(selectedAiProvider?.reason || 'Select files and configure an AI provider.');
        return;
      }
      cancelAiAssistant();
      const operationId = window.crypto.randomUUID();
      const controller = new AbortController();
      activeAssistantRef.current = {
        operationId,
        controller,
        selectionFingerprint,
      };
      setIsRunningAiAssistant(true);
      setAiError(null);
      if (kind === 'review') setAiReview(null);
      else setAiCommitPlan(null);
      try {
        const request = {
          operationId,
          workingCopyPath,
          paths: selectedFiles.map((file) => file.path),
        };
        if (kind === 'review') {
          const result = await window.api.ai.reviewCommit(request, { signal: controller.signal });
          setAiReview(result);
          void captureReviewCenterResult({
            kind: 'review',
            workingCopyPath,
            checksum: checksumReviewInput(selectionFingerprint),
            result,
          });
        } else {
          const result = await window.api.ai.planCommit(request, { signal: controller.signal });
          setAiCommitPlan(result);
          void captureReviewCenterResult({
            kind: 'plan',
            workingCopyPath,
            checksum: checksumReviewInput(selectionFingerprint),
            result,
          });
        }
      } catch (analysisError) {
        if (!controller.signal.aborted) {
          setAiError(
            analysisError instanceof Error ? analysisError.message : 'AI analysis failed.'
          );
        }
      } finally {
        if (activeAssistantRef.current?.operationId === operationId) {
          activeAssistantRef.current = null;
          setIsRunningAiAssistant(false);
        }
      }
    },
    [
      aiProviderAvailable,
      cancelAiAssistant,
      selectedAiProvider?.reason,
      selectedFiles,
      selectionFingerprint,
      workingCopyPath,
    ]
  );

  const handleExplainDiff = useCallback(
    async (mode: AiDiffExplanationMode = aiExplanationMode) => {
      if (!selectedDiffFile || !aiProviderAvailable) {
        setAiError(selectedAiProvider?.reason || 'Select a file and configure an AI provider.');
        return;
      }
      cancelAiAssistant();
      const operationId = window.crypto.randomUUID();
      const controller = new AbortController();
      activeAssistantRef.current = { operationId, controller, selectionFingerprint };
      setIsRunningAiAssistant(true);
      setAiError(null);
      setAiDiffExplanation(null);
      try {
        const result = await window.api.ai.explainDiff(
          {
            operationId,
            workingCopyPath,
            path: selectedDiffFile,
            mode,
          },
          { signal: controller.signal }
        );
        setAiDiffExplanation(result);
        void captureReviewCenterResult({
          kind: 'explanation',
          workingCopyPath,
          filePath: selectedDiffFile,
          checksum: checksumReviewInput(`${selectionFingerprint}\n${selectedDiffFile}`),
          mode,
          result,
        });
      } catch (explanationError) {
        if (!controller.signal.aborted) {
          setAiError(
            explanationError instanceof Error
              ? explanationError.message
              : 'Diff explanation failed.'
          );
        }
      } finally {
        if (activeAssistantRef.current?.operationId === operationId) {
          activeAssistantRef.current = null;
          setIsRunningAiAssistant(false);
        }
      }
    },
    [
      aiExplanationMode,
      aiProviderAvailable,
      cancelAiAssistant,
      selectedAiProvider?.reason,
      selectedDiffFile,
      selectionFingerprint,
      workingCopyPath,
    ]
  );

  const prepareAiConsent = useCallback(
    async (
      action: 'draft' | 'review' | 'plan' | 'explain' | 'transform',
      transformation?: AiDraftTransformation
    ) => {
      if (selectedFiles.length === 0 || !aiProviderAvailable) {
        setAiError(selectedAiProvider?.reason || 'Select files and configure an AI provider.');
        return;
      }
      setPendingAiAction(action);
      setAiError(null);
      setAiPromptPreview(null);
      setShowAiConsent(true);
      setIsPreparingAiPrompt(true);
      const operationId = window.crypto.randomUUID();
      const selectedRequest = {
        operationId,
        workingCopyPath,
        paths: selectedFiles.map((file) => file.path),
      };
      try {
        if (action === 'draft') {
          setAiPromptPreview(
            await window.api.ai.preparePrompt({
              task: 'commit-message',
              request: { ...selectedRequest, existingMessage: message },
            })
          );
        } else if (action === 'transform' && transformation) {
          setAiPromptPreview(
            await window.api.ai.preparePrompt({
              task: 'draft-transformation',
              request: {
                ...selectedRequest,
                currentDraft: message,
                transformation,
              },
            })
          );
        } else if (action === 'review') {
          setAiPromptPreview(
            await window.api.ai.preparePrompt({
              task: 'pre-commit-review',
              request: selectedRequest,
            })
          );
        } else if (action === 'plan') {
          setAiPromptPreview(
            await window.api.ai.preparePrompt({ task: 'commit-plan', request: selectedRequest })
          );
        } else if (selectedDiffFile) {
          setAiPromptPreview(
            await window.api.ai.preparePrompt({
              task: 'diff-explanation',
              request: {
                operationId,
                workingCopyPath,
                path: selectedDiffFile,
                mode: aiExplanationMode,
              },
            })
          );
        }
      } catch (previewError) {
        setAiError(
          previewError instanceof Error ? previewError.message : 'Could not prepare prompt preview.'
        );
      } finally {
        setIsPreparingAiPrompt(false);
      }
    },
    [
      aiExplanationMode,
      aiProviderAvailable,
      message,
      selectedAiProvider?.reason,
      selectedDiffFile,
      selectedFiles,
      workingCopyPath,
    ]
  );

  const handleApplyCommitGroup = (groupId: string) => {
    const group = aiCommitPlan?.groups.find((candidate) => candidate.id === groupId);
    if (!group) return;
    const groupPaths = new Set(group.paths);
    setFiles((previous) =>
      previous.map((file) => ({
        ...file,
        selected: file.committable && groupPaths.has(file.path),
      }))
    );
    if (group.suggestedMessage) setMessage(group.suggestedMessage);
  };

  const handleCreateGroupChangelist = async (groupId: string) => {
    const group = aiCommitPlan?.groups.find((candidate) => candidate.id === groupId);
    if (!group) return;
    const changelistName = group.title
      .replace(/[\u0000\r\n]/g, ' ')
      .trim()
      .slice(0, 80);
    const result = await window.api.svn.changelist.add(
      group.paths,
      changelistName.startsWith('-') ? `Group ${changelistName}` : changelistName
    );
    if (!result.success) throw new Error(result.error || 'Failed to create changelist.');
    await refetch();
  };

  useEffect(() => {
    if (message.trim()) {
      let cancelled = false;
      void import('@renderer/utils/suggestionEngine').then(({ validateCommitMessage }) => {
        if (!cancelled) {
          const validation = validateCommitMessage(message);
          setValidationWarnings(validation.warnings);
        }
      });
      return () => {
        cancelled = true;
      };
    } else {
      setValidationWarnings([]);
    }
    return undefined;
  }, [message]);

  useEffect(() => {
    setAiDiffExplanation(null);
  }, [selectedDiffFile]);

  const handleToggleFile = (path: string) => {
    setFiles((previous) =>
      previous.map((file) =>
        file.path === path && file.committable ? { ...file, selected: !file.selected } : file
      )
    );
  };

  const handleSelectAll = () => {
    setFiles((previous) => previous.map((file) => ({ ...file, selected: file.committable })));
  };

  const handleDeselectAll = () => {
    setFiles((previous) => previous.map((file) => ({ ...file, selected: false })));
  };

  const handleRevertFile = async (path: string) => {
    try {
      await window.api.svn.revert([path]);
      void refetch();
      void refetchDeepStatus();
    } catch (revertError) {
      console.error('Revert failed:', revertError);
    }
  };

  const handleTemplateSelect = async (templateId: string) => {
    try {
      setTemplateContext({
        path: workingCopyPath,
        files: selectedFiles.map((file) => file.path),
      });
      setMessage(await applyTemplate(templateId));
      setShowTemplates(false);
      setShowTemplateManager(false);
      textareaRef.current?.focus();
    } catch (templateError) {
      setError(templateError instanceof Error ? templateError.message : 'Failed to apply template');
    }
  };

  const handleManagedTemplateSelect = (template: string) => {
    setMessage(template);
    setShowTemplateManager(false);
    setShowTemplates(false);
    textareaRef.current?.focus();
  };

  const handleHistorySelect = (nextMessage: string) => {
    setMessage(nextMessage);
    setShowHistory(false);
    textareaRef.current?.focus();
  };

  const handleApplySuggestion = (suggestion: (typeof aiSuggestions)[0]) => {
    setMessage(`${suggestion.prefix}: ${suggestion.description}`);
    setShowSuggestions(false);
    textareaRef.current?.focus();
  };

  const handleApplyRecommendation = (recommendation: TemplateRecommendation) => {
    setMessage(recommendation.template);
    setShowTemplates(false);
    textareaRef.current?.focus();
  };

  const handleIssuePatternChange = (issueIdPattern: string) => {
    updateRules({ issueIdPattern });
    updateIssueTrackerConfig({ issueIdPattern });
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submissionInFlightRef.current) return;

    if (!message.trim()) {
      setError('Please enter a commit message');
      return;
    }

    if (selectedCount === 0) {
      setError('Please select at least one file to commit');
      return;
    }

    if (ruleErrors.length > 0) {
      setError(ruleErrors[0]);
      return;
    }

    submissionInFlightRef.current = true;
    setIsSubmitting(true);
    setError(null);

    try {
      const pathsToCommit = selectedFiles.map((file) => file.path);
      const result = await onSubmit(pathsToCommit, message.trim());

      if (result.success) {
        addMessage(message.trim(), workingCopyPath);
        setSuccess({ revision: result.revision || 0 });
      } else {
        setError(result.message || 'Commit failed');
      }
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Commit failed');
    } finally {
      submissionInFlightRef.current = false;
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    if (!isSubmitting) {
      cancelMessageGeneration();
      cancelAiAssistant();
      onClose();
    }
  };

  return {
    message,
    setMessage,
    handleMessageChange,
    isSubmitting,
    isGeneratingMessage,
    isRunningAiAssistant,
    isLoadingAiProviders,
    aiProviderAvailable,
    aiProviderName: selectedAiProvider?.provider ?? settings.aiCommit.provider,
    aiModelName:
      selectedAiProvider?.provider === 'codex' || settings.aiCommit.provider === 'codex'
        ? settings.aiCommit.codexModel
        : undefined,
    aiProviderReason: settings.aiCommit.enabled
      ? selectedAiProvider?.reason
      : 'Enable AI commit messages in Settings > SVN.',
    showAiConsent,
    setShowAiConsent,
    aiPromptPreview,
    isPreparingAiPrompt,
    aiError,
    aiGenerationNotice,
    enabledDraftTransformations,
    aiReview,
    aiCommitPlan,
    aiDiffExplanation,
    aiExplanationMode,
    setAiExplanationMode,
    error,
    success,
    selectedDiffFile,
    setSelectedDiffFile,
    showTemplates,
    setShowTemplates,
    showHistory,
    setShowHistory,
    showTemplateManager,
    setShowTemplateManager,
    fileFilter,
    setFileFilter,
    diffViewMode,
    setDiffViewMode,
    showSuggestions,
    setShowSuggestions,
    showRules,
    setShowRules,
    validationWarnings,
    commitWarnings,
    textareaRef,
    history,
    templates,
    issueTrackerConfig,
    updateIssueTrackerConfig,
    rules,
    updateRules,
    isLoadingStatus,
    files,
    refetch,
    aiSuggestions,
    templateRecommendations,
    autocompleteOptions,
    diffData,
    filteredFiles,
    selectedCount,
    committableCount,
    ruleErrors,
    issueLinks,
    modalRef,
    dialogId,
    titleId,
    descriptionId,
    handleToggleFile,
    handleSelectAll,
    handleDeselectAll,
    handleRevertFile,
    handleTemplateSelect,
    handleManagedTemplateSelect,
    handleHistorySelect,
    handleApplySuggestion,
    handleApplyRecommendation,
    handleGenerateMessage,
    handleTransformDraft,
    handleConfirmAiGeneration,
    handleReviewCommit: () => {
      if (settings.aiCommit.confirmBeforeSending) {
        void prepareAiConsent('review');
      } else void runSelectedAiAnalysis('review');
    },
    handlePlanCommit: () => {
      if (settings.aiCommit.confirmBeforeSending) {
        void prepareAiConsent('plan');
      } else void runSelectedAiAnalysis('plan');
    },
    handleExplainDiff: (mode?: AiDiffExplanationMode) => {
      if (mode) setAiExplanationMode(mode);
      if (settings.aiCommit.confirmBeforeSending) {
        void prepareAiConsent('explain');
      } else void handleExplainDiff(mode);
    },
    handleApplyCommitGroup,
    handleCreateGroupChangelist,
    cancelAiAssistant,
    cancelMessageGeneration,
    handleIssuePatternChange,
    handleOpenIssue: openIssue,
    handleSubmit,
    handleClose,
  };
}
