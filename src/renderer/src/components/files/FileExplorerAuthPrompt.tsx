import { Lock, X } from 'lucide-react';

interface FileExplorerAuthPromptProps {
  realm: string;
  username: string;
  password: string;
  onUsernameChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
}

export function FileExplorerAuthPrompt({
  realm,
  username,
  password,
  onUsernameChange,
  onPasswordChange,
  onCancel,
  onSubmit,
}: FileExplorerAuthPromptProps) {
  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal w-[400px]" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">
            <Lock className="w-5 h-5 text-accent" />
            Authentication Required
          </h2>
          <button type="button" onClick={onCancel} className="btn-icon-sm">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="modal-body space-y-4">
          <p className="text-sm text-text-secondary">
            Authentication is required to view remote files from this repository.
          </p>
          <div>
            <p className="block text-sm font-medium text-text mb-1.5">Realm</p>
            <div className="px-3 py-2 bg-bg-tertiary border border-border rounded-md text-sm text-text-muted truncate">
              {realm}
            </div>
          </div>
          <div>
            <label htmlFor="file-explorer-auth-username" className="block text-sm font-medium text-text mb-1.5">
              Username
            </label>
            <input
              id="file-explorer-auth-username"
              type="text"
              value={username}
              onChange={(event) => onUsernameChange(event.target.value)}
              className="input"
            />
          </div>
          <div>
            <label htmlFor="file-explorer-auth-password" className="block text-sm font-medium text-text mb-1.5">
              Password
            </label>
            <input
              id="file-explorer-auth-password"
              type="password"
              value={password}
              onChange={(event) => onPasswordChange(event.target.value)}
              onKeyDown={(event) => event.key === 'Enter' && onSubmit()}
              className="input"
            />
          </div>
        </div>
        <div className="modal-footer">
          <button type="button" onClick={onCancel} className="btn btn-ghost">
            Cancel
          </button>
          <button type="button" onClick={onSubmit} disabled={!username} className="btn btn-primary">
            Save Credentials
          </button>
        </div>
      </div>
    </div>
  );
}
