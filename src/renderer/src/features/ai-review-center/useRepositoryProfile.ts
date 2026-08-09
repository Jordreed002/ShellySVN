import { useCallback, useEffect, useState } from 'react';
import {
  emptyRepositoryProfile,
  repositoryProfileApi,
  type RepositoryProfile,
  type RepositoryProfileImportPreview,
} from './repositoryProfileAdapter';

export function useRepositoryProfile(workingCopyPath: string) {
  const [profile, setProfile] = useState<RepositoryProfile>(emptyRepositoryProfile);
  const [exists, setExists] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
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

  return {
    profile,
    setProfile,
    exists,
    isLoading,
    isSaving,
    error,
    importPreview,
    setImportPreview,
    save,
    remove,
    previewImport,
    applyImportPreview,
  };
}
