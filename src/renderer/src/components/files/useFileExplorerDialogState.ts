import { useState } from 'react';
import type { SvnStatusEntry } from '@shared/types';

export function useFileExplorerDialogState() {
  const [diffViewerPath, setDiffViewerPath] = useState<string | null>(null);
  const [logViewerPath, setLogViewerPath] = useState<string | null>(null);
  const [settingsDialogOpen, setSettingsDialogOpen] = useState(false);
  const [updateDialogOpen, setUpdateDialogOpen] = useState(false);
  const [pendingUpdateEntry, setPendingUpdateEntry] = useState<SvnStatusEntry | null>(null);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const [branchTagPath, setBranchTagPath] = useState<string | null>(null);
  const [branchTagMode, setBranchTagMode] = useState<'branch' | 'tag'>('branch');
  const [branchTagCompareOpen, setBranchTagCompareOpen] = useState(false);
  const [switchPath, setSwitchPath] = useState<string | null>(null);
  const [mergePath, setMergePath] = useState<string | null>(null);
  const [relocatePath, setRelocatePath] = useState<string | null>(null);
  const [blamePath, setBlamePath] = useState<string | null>(null);
  const [propertiesPath, setPropertiesPath] = useState<string | null>(null);
  const [changelistPath, setChangelistPath] = useState<string | null>(null);
  const [createPatchPath, setCreatePatchPath] = useState<string | null>(null);
  const [applyPatchPath, setApplyPatchPath] = useState<string | null>(null);
  const [ignoreEntry, setIgnoreEntry] = useState<{ path: string; fileName?: string } | null>(null);
  const [shelveDialogPath, setShelveDialogPath] = useState<string | null>(null);
  const [lockManagementPath, setLockManagementPath] = useState<string | null>(null);
  const [exportPath, setExportPath] = useState<string | null>(null);
  const [revisionGraphPath, setRevisionGraphPath] = useState<string | null>(null);
  const [repoBrowserUrl, setRepoBrowserUrl] = useState<string | null>(null);
  const [isImportDialogOpen, setIsImportDialogOpen] = useState(false);
  const [resolveEntry, setResolveEntry] = useState<SvnStatusEntry | null>(null);
  const [moveRenameTarget, setMoveRenameTarget] = useState<{
    path: string;
    mode: 'move' | 'rename';
  } | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [showNotes, setShowNotes] = useState(false);

  return {
    applyPatchPath,
    blamePath,
    branchTagCompareOpen,
    branchTagMode,
    branchTagPath,
    changelistPath,
    createPatchPath,
    diagnosticsOpen,
    diffViewerPath,
    exportPath,
    ignoreEntry,
    isImportDialogOpen,
    lockManagementPath,
    logViewerPath,
    mergePath,
    moveRenameTarget,
    pendingUpdateEntry,
    propertiesPath,
    relocatePath,
    repoBrowserUrl,
    resolveEntry,
    revisionGraphPath,
    setApplyPatchPath,
    setBlamePath,
    setBranchTagCompareOpen,
    setBranchTagMode,
    setBranchTagPath,
    setChangelistPath,
    setCreatePatchPath,
    setDiagnosticsOpen,
    setDiffViewerPath,
    setExportPath,
    setIgnoreEntry,
    setIsImportDialogOpen,
    setLockManagementPath,
    setLogViewerPath,
    setMergePath,
    setMoveRenameTarget,
    setPendingUpdateEntry,
    setPropertiesPath,
    setRelocatePath,
    setRepoBrowserUrl,
    setResolveEntry,
    setRevisionGraphPath,
    setSettingsDialogOpen,
    setShelveDialogPath,
    setShowNotes,
    setShowPreview,
    setSwitchPath,
    setUpdateDialogOpen,
    settingsDialogOpen,
    shelveDialogPath,
    showNotes,
    showPreview,
    switchPath,
    updateDialogOpen,
  };
}
