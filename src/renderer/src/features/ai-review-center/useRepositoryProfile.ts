import { useCallback, useEffect, useState } from 'react';
import {
  emptyRepositoryProfile,
  repositoryProfileApi,
  type RepositoryProfile,
  type RepositoryProfileImportPreview,
} from './repositoryProfileAdapter';
import { analyzeCommitStyle, splitCommitMessage } from './lib/styleLearner';

/** How much history the style learner samples (bounded for large repositories). */
const STYLE_SAMPLE_LIMIT = 200;

export function useRepositoryProfile(workingCopyPath: string) {
  const [profile, setProfile] = useState<RepositoryProfile>(emptyRepositoryProfile);
  const [exists, setExists] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isLearningStyle, setIsLearningStyle] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [importPreview, setImportPreview] = useState<RepositoryProfileImportPreview | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const stored = await repositoryProfileApi().get(workingCopyPath);
      setProfile(stored ?? emptyRepositoryProfile());
      setExists(Boolean(stored));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load the profile.');
    } finally {
      setIsLoading(false);
    }
  }, [workingCopyPath]);

  useEffect(() => void load(), [load]);

  const save = async () => {
    setIsSaving(true);
    setError(null);
    try {
      const next = { ...profile, updatedAt: new Date().toISOString() };
      await repositoryProfileApi().save(workingCopyPath, next);
      setProfile(next);
      setExists(true);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not save the profile.');
    } finally {
      setIsSaving(false);
    }
  };

  const remove = async () => {
    setIsSaving(true);
    setError(null);
    try {
      await repositoryProfileApi().remove(workingCopyPath);
      setProfile(emptyRepositoryProfile());
      setExists(false);
      setImportPreview(null);
    } catch (removeError) {
      setError(
        removeError instanceof Error ? removeError.message : 'Could not remove the profile.'
      );
    } finally {
      setIsSaving(false);
    }
  };

  const previewImport = async (input: string) => {
    setError(null);
    try {
      const preview = await repositoryProfileApi().previewImport(input);
      setImportPreview(preview);
    } catch (previewError) {
      setError(previewError instanceof Error ? previewError.message : 'Could not preview import.');
    }
  };

  const applyImportPreview = () => {
    if (!importPreview?.valid || !importPreview.profile) return;
    setProfile(importPreview.profile);
    setImportPreview(null);
  };

  /**
   * #110: sample the repository's own commit log, compute style hints locally
   * (pure analyzer — no AI call, nothing leaves the machine), and stage them
   * on the profile. The user still presses Save to persist.
   */
  const learnStyle = useCallback(async (): Promise<number> => {
    setIsLearningStyle(true);
    setError(null);
    try {
      const log = await window.api.svn.log(workingCopyPath, STYLE_SAMPLE_LIMIT);
      if (log.cancelled) throw new Error('Reading commit history was cancelled.');
      if (log.error || log.parseError) {
        throw new Error(log.error || `Failed to parse SVN log: ${log.parseError}`);
      }
      const hints = analyzeCommitStyle(
        log.entries.map((entry) => splitCommitMessage(entry.message ?? '')),
        { issueIdPattern: profile.issueIdPattern }
      );
      setProfile((current) => ({ ...current, styleHints: hints }));
      return hints.sampledCommits;
    } catch (learnError) {
      setError(
        learnError instanceof Error ? learnError.message : 'Could not learn the commit style.'
      );
      return 0;
    } finally {
      setIsLearningStyle(false);
    }
  }, [profile.issueIdPattern, workingCopyPath]);

  const clearStyleHints = useCallback(() => {
    setProfile((current) => ({ ...current, styleHints: undefined }));
  }, []);

  return {
    profile,
    setProfile,
    exists,
    isLoading,
    isSaving,
    isLearningStyle,
    error,
    importPreview,
    setImportPreview,
    save,
    remove,
    previewImport,
    applyImportPreview,
    learnStyle,
    clearStyleHints,
  };
}
