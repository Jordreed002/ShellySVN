import { lazy } from 'react';
import { Loader, Upload } from 'lucide-react';

export const loadCommitDialog = () =>
  import('../ui/CommitDialog').then((m) => ({ default: m.CommitDialog }));

export const CommitDialog = lazy(loadCommitDialog);
export const DiffViewer = lazy(() =>
  import('../ui/DiffViewer').then((m) => ({ default: m.DiffViewer }))
);
export const FilePreview = lazy(() =>
  import('../ui/FilePreview').then((m) => ({ default: m.FilePreview }))
);
export const LogViewer = lazy(() =>
  import('../ui/LogViewer').then((m) => ({ default: m.LogViewer }))
);
export const UpdateToRevisionDialog = lazy(() =>
  import('../ui/UpdateToRevisionDialog').then((m) => ({ default: m.UpdateToRevisionDialog }))
);
export const RepoDiagnosticsPanel = lazy(() =>
  import('../RepoDiagnostics').then((m) => ({ default: m.RepoDiagnosticsPanel }))
);
export const BranchTagDialog = lazy(() =>
  import('../ui/BranchTagDialog').then((m) => ({ default: m.BranchTagDialog }))
);
export const BranchTagCompareDialog = lazy(() =>
  import('../ui/BranchTagCompareDialog').then((m) => ({ default: m.BranchTagCompareDialog }))
);
export const SwitchDialog = lazy(() =>
  import('../ui/SwitchDialog').then((m) => ({ default: m.SwitchDialog }))
);
export const MergeWizard = lazy(() =>
  import('../ui/MergeWizard').then((m) => ({ default: m.MergeWizard }))
);
export const RelocateDialog = lazy(() =>
  import('../ui/RelocateDialog').then((m) => ({ default: m.RelocateDialog }))
);
export const BlameViewer = lazy(() =>
  import('../ui/BlameViewer').then((m) => ({ default: m.BlameViewer }))
);
export const PropertiesDialog = lazy(() =>
  import('../ui/PropertiesDialog').then((m) => ({ default: m.PropertiesDialog }))
);
export const ChangelistDialog = lazy(() =>
  import('../ui/ChangelistDialog').then((m) => ({ default: m.ChangelistDialog }))
);
export const CreatePatchDialog = lazy(() =>
  import('../ui/CreatePatchDialog').then((m) => ({ default: m.CreatePatchDialog }))
);
export const ApplyPatchDialog = lazy(() =>
  import('../ui/ApplyPatchDialog').then((m) => ({ default: m.ApplyPatchDialog }))
);
export const IgnoreDialog = lazy(() =>
  import('../ui/IgnoreDialog').then((m) => ({ default: m.IgnoreDialog }))
);
export const ShelveDialog = lazy(() =>
  import('../ui/ShelveDialog').then((m) => ({ default: m.ShelveDialog }))
);
export const QuickNotesPanel = lazy(() =>
  import('../ui/QuickNotesPanel').then((m) => ({ default: m.QuickNotesPanel }))
);
export const LockManagementDialog = lazy(() =>
  import('../ui/LockManagementDialog').then((m) => ({ default: m.LockManagementDialog }))
);
export const ExportDialog = lazy(() =>
  import('../ui/ExportDialog').then((m) => ({ default: m.ExportDialog }))
);
export const RevisionGraph = lazy(() =>
  import('../ui/RevisionGraph').then((m) => ({ default: m.RevisionGraph }))
);
export const ImportDialog = lazy(() =>
  import('../ui/ImportDialog').then((m) => ({ default: m.ImportDialog }))
);
export const ResolveDialog = lazy(() =>
  import('../ui/ResolveDialog').then((m) => ({ default: m.ResolveDialog }))
);
export const MoveRenameDialog = lazy(() =>
  import('../ui/MoveRenameDialog').then((m) => ({ default: m.MoveRenameDialog }))
);

export function DialogLoader() {
  return (
    <div className="modal-overlay">
      <div className="modal flex items-center justify-center">
        <Loader className="w-6 h-6 animate-spin text-accent" />
      </div>
    </div>
  );
}

export function CommitDialogLoader() {
  return (
    <div className="modal-overlay" role="presentation">
      <div className="modal w-[900px] max-h-[90vh]" role="dialog" aria-modal="true">
        <div className="modal-header">
          <h2 className="modal-title">
            <Upload className="w-5 h-5 text-accent" aria-hidden="true" />
            Commit Changes
          </h2>
          <button className="btn-icon-sm" disabled aria-label="Close dialog">
            <span className="sr-only">Close dialog</span>
          </button>
        </div>
        <div className="flex" style={{ height: '500px' }}>
          <div className="w-[350px] border-r border-border flex flex-col">
            <div className="px-3 py-2 border-b border-border bg-bg-tertiary">
              <div className="h-8 rounded bg-bg-elevated animate-pulse" />
            </div>
            <div className="flex-1 flex items-center justify-center">
              <Loader className="w-5 h-5 animate-spin text-accent" aria-hidden="true" />
              <span className="sr-only">Loading files...</span>
            </div>
          </div>
          <div className="flex-1 flex flex-col">
            <div className="border-b border-border p-4 space-y-3">
              <div className="h-4 w-28 rounded bg-bg-elevated animate-pulse" />
              <div className="h-24 rounded bg-bg-elevated animate-pulse" />
            </div>
            <div className="flex-1 p-4">
              <div className="h-full rounded bg-bg-elevated animate-pulse" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
