import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useCommitMessageHistory } from '@renderer/hooks/useCommitMessageHistory';
import { setTemplateContext, useCommitTemplates } from '@renderer/hooks/useCommitTemplates';
import { useCommitRules } from '@renderer/hooks/useCommitRules';
import { useFocusTrap } from '@renderer/hooks/useFocusTrap';
import { useIssueTrackerConfig } from '@renderer/hooks/useIssueTrackerConfig';
import { buildPathAutocompleteOptions } from '@renderer/utils/commitAutocomplete';
import { getCommitWarnings } from '@renderer/utils/commitWarnings';
import { validateCommitRules } from '@renderer/utils/commitRules';
import { extractIssueLinks } from '@renderer/utils/issueTracker';
import {
  analyzeFiles,
  getAutocompleteSuggestions,
  getTemplatesWithRecommendations,
  validateCommitMessage,
  type TemplateRecommendation,
} from '@renderer/utils/suggestionEngine';
import type { SvnStatusChar } from '@shared/types';
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

const COMMITABLE_STATUSES: SvnStatusChar[] = ['M', 'A', 'D', 'R', 'C', '?'];
const DISPLAY_ONLY_STATUSES: SvnStatusChar[] = ['!', '~', 'X'];

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

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { history, addMessage } = useCommitMessageHistory();
  const { templates, applyTemplate } = useCommitTemplates();
  const issueTrackerLookupPath = files.find((file) => file.selected)?.path || workingCopyPath;
  const { config: issueTrackerConfig, updateConfig: updateIssueTrackerConfig } =
    useIssueTrackerConfig(workingCopyPath, issueTrackerLookupPath);
  const { rules, updateRules } = useCommitRules(workingCopyPath, issueTrackerConfig);

  const modalRef = useFocusTrap({
    active: isOpen && !success,
    onEscape: () => {
      if (!isSubmitting) onClose();
    },
    initialFocus: () => textareaRef.current,
    returnFocus: true,
  });

  const dialogId = useMemo(() => `commit-dialog-${Math.random().toString(36).slice(2, 11)}`, []);
  const titleId = `${dialogId}-title`;
  const descriptionId = `${dialogId}-description`;

  const {
    data: statusData,
    isLoading: isLoadingStatus,
    refetch,
  } = useQuery({
    queryKey: ['svn:status', workingCopyPath],
    queryFn: () => window.api.svn.status(workingCopyPath),
    enabled: isOpen && !!workingCopyPath,
  });

  useEffect(() => {
    if (statusData?.entries) {
      const commitFiles = statusData.entries
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
      setFiles(commitFiles);
    }
  }, [statusData]);

  const aiSuggestions = useMemo(() => {
    const selectedFilesList = files.filter((file) => file.selected);
    if (selectedFilesList.length === 0) return [];

    const { suggestions } = analyzeFiles(
      selectedFilesList.map((file) => ({ path: file.path, status: file.status }))
    );
    return suggestions;
  }, [files]);

  const templateRecommendations = useMemo(() => {
    const selectedFilesList = files.filter((file) => file.selected);
    if (selectedFilesList.length === 0) return [];

    return getTemplatesWithRecommendations(
      selectedFilesList.map((file) => ({ path: file.path, status: file.status }))
    );
  }, [files]);

  const autocompleteOptions = useMemo((): AutocompleteOption[] => {
    const options: AutocompleteOption[] = [];
    const selectedFilesList = files.filter((file) => file.selected);
    const selectedFileSummaries = selectedFilesList.map((file) => ({
      path: file.path,
      status: file.status,
    }));

    for (const suggestion of aiSuggestions.slice(0, 3)) {
      const fullMessage = `${suggestion.prefix}: ${suggestion.description}`;
      options.push({
        value: fullMessage,
        label: `${suggestion.prefix}: ${suggestion.description}`,
        description: `${Math.round(suggestion.confidence * 100)}% confidence`,
        category: 'AI Suggestions',
      });
    }

    const keywordSuggestions = getAutocompleteSuggestions(
      message,
      selectedFileSummaries,
      history.map((historyItem) => historyItem.message)
    );

    for (const suggestion of keywordSuggestions.slice(0, 5)) {
      options.push({
        value: suggestion,
        label: suggestion,
        description: 'Commit keyword',
        category: 'Keywords',
      });
    }

    options.push(...buildPathAutocompleteOptions(message, selectedFileSummaries));

    for (const historyItem of history.slice(0, 5)) {
      options.push({
        value: historyItem.message,
        label:
          historyItem.message.slice(0, 50) + (historyItem.message.length > 50 ? '...' : ''),
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
  }, [aiSuggestions, files, history, message]);

  const { data: diffData } = useQuery({
    queryKey: ['svn:diff', selectedDiffFile],
    queryFn: () => window.api.svn.diff(selectedDiffFile!),
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

  const selectedFiles = files.filter((file) => file.selected && file.committable);
  const selectedCount = selectedFiles.length;
  const committableCount = files.filter((file) => file.committable).length;
  const commitWarnings = useMemo(
    () => getCommitWarnings(files, statusData?.entries ?? files),
    [files, statusData?.entries]
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
      setValidationWarnings([]);
      setTimeout(() => textareaRef.current?.focus(), 100);
    }
  }, [isOpen]);

  useEffect(() => {
    if (message.trim()) {
      const validation = validateCommitMessage(message);
      setValidationWarnings(validation.warnings);
    } else {
      setValidationWarnings([]);
    }
  }, [message]);

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
      refetch();
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

    setIsSubmitting(true);
    setError(null);

    const pathsToCommit = selectedFiles.map((file) => file.path);
    const result = await onSubmit(pathsToCommit, message.trim());

    if (result.success) {
      addMessage(message.trim(), workingCopyPath);
      setSuccess({ revision: result.revision || 0 });
    } else {
      setError(result.message || 'Commit failed');
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    if (!isSubmitting) {
      onClose();
    }
  };

  return {
    message,
    setMessage,
    isSubmitting,
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
    handleIssuePatternChange,
    handleOpenIssue: openIssue,
    handleSubmit,
    handleClose,
  };
}
