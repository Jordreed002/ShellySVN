import { X, Puzzle } from 'lucide-react';

interface PluginManagerDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

export function PluginManagerDialog({ isOpen, onClose }: PluginManagerDialogProps) {
  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal w-[700px] max-h-[80vh]" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="flex items-center gap-2">
            <Puzzle className="w-5 h-5" />
            <h2>Plugin Manager</h2>
          </div>
          <button type="button" onClick={onClose} className="btn-ghost btn-sm">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="modal-body">
          <div className="text-center py-8 text-text-secondary">
            <Puzzle className="w-12 h-12 mx-auto mb-4 opacity-50" />
            <p>Plugin management coming soon.</p>
            <p className="text-sm mt-2">Install, configure, and manage plugins to extend ShellySVN.</p>
          </div>
        </div>
        <div className="modal-footer">
          <button type="button" onClick={onClose} className="btn btn-secondary">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
