import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertCircle,
  CheckCircle,
  FolderSync,
  Image,
  Info,
  Loader2,
  RefreshCw,
  Shield,
  Terminal,
  X,
} from 'lucide-react';
import type { ShellIntegrationStatus } from '@shared/types';

interface ShellIntegrationDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

function PlatformInfo({ status }: { status: ShellIntegrationStatus }) {
  if (status.platform === 'windows') {
    return (
      <div className="bg-info/10 border border-info/20 rounded-lg p-3">
        <div className="flex items-start gap-2">
          <Info className="w-4 h-4 text-info mt-0.5 flex-shrink-0" />
          <div className="text-sm text-info">
            <p className="font-medium">Windows Integration</p>
            <ul className="mt-1 text-info/80 space-y-0.5">
              <li>- Icon overlays show SVN status on files/folders</li>
              <li>- Right-click context menu for SVN operations</li>
              <li>- Requires native shell helper in packaged builds</li>
            </ul>
          </div>
        </div>
      </div>
    );
  }

  if (status.platform === 'macos') {
    return (
      <div className="bg-info/10 border border-info/20 rounded-lg p-3">
        <div className="flex items-start gap-2">
          <Info className="w-4 h-4 text-info mt-0.5 flex-shrink-0" />
          <div className="text-sm text-info">
            <p className="font-medium">macOS Integration</p>
            <ul className="mt-1 text-info/80 space-y-0.5">
              <li>- Finder Sync extension for icon badges</li>
              <li>- Context menu in Finder</li>
              <li>- Requires signed packaged app extension</li>
            </ul>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-warning/10 border border-warning/30 rounded-lg p-3">
      <div className="flex items-start gap-2">
        <AlertCircle className="w-4 h-4 text-warning mt-0.5 flex-shrink-0" />
        <div className="text-sm text-warning">
          <p className="font-medium">Native Integration Deferred</p>
          <p className="mt-1 text-warning/80">
            Use the ShellySVN file explorer, toolbar, context menus, and command palette for SVN
            workflows on this platform.
          </p>
        </div>
      </div>
    </div>
  );
}

function DetailList({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;

  return (
    <div className="bg-bg-secondary rounded-lg p-3">
      <p className="text-sm font-medium text-text mb-2">{title}</p>
      <ul className="space-y-1 text-xs text-text-secondary">
        {items.map((item) => (
          <li key={item}>- {item}</li>
        ))}
      </ul>
    </div>
  );
}

export function ShellIntegrationDialog({ isOpen, onClose }: ShellIntegrationDialogProps) {
  const queryClient = useQueryClient();
  const [isRegistering, setIsRegistering] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const {
    data: status,
    isLoading,
    refetch,
  } = useQuery({
    queryKey: ['shell:status'],
    queryFn: () => window.api.shell.getStatus(),
    enabled: isOpen,
  });

  const registerMutation = useMutation({
    mutationFn: async () => {
      setIsRegistering(true);
      setError(null);

      const result = await window.api.shell.register();
      if (!result.success) {
        throw new Error(result.error || 'Failed to register shell integration');
      }

      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shell:status'] });
      setIsRegistering(false);
    },
    onError: (err) => {
      setError((err as Error).message || 'Failed to register shell integration');
      setIsRegistering(false);
    },
  });

  const unregisterMutation = useMutation({
    mutationFn: async () => {
      setIsRegistering(true);
      setError(null);

      const result = await window.api.shell.unregister();
      if (!result.success) {
        throw new Error('Failed to unregister shell integration');
      }

      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shell:status'] });
      setIsRegistering(false);
    },
    onError: (err) => {
      setError((err as Error).message || 'Failed to unregister shell integration');
      setIsRegistering(false);
    },
  });

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal w-[550px]" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">
            <Shield className="w-5 h-5 text-accent" />
            Shell Integration
          </h2>
          <button onClick={onClose} className="btn-icon-sm">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="modal-body space-y-4">
          {isLoading || !status ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 text-text-muted animate-spin" />
            </div>
          ) : (
            <>
              <div
                className={`rounded-lg p-4 ${
                  status.registered
                    ? 'bg-success/10 border border-success/30'
                    : 'bg-bg-tertiary border border-border'
                }`}
              >
                <div className="flex items-center gap-3">
                  {status.registered ? (
                    <CheckCircle className="w-6 h-6 text-success" />
                  ) : (
                    <AlertCircle className="w-6 h-6 text-text-muted" />
                  )}
                  <div>
                    <p className="font-medium text-text">
                      {status.registered
                        ? 'Shell Integration Active'
                        : 'Shell Integration Not Active'}
                    </p>
                    <p className="text-sm text-text-secondary">{status.message}</p>
                  </div>
                </div>
              </div>

              <PlatformInfo status={status} />

              <div className="space-y-2">
                <h4 className="text-sm font-medium text-text">Available Features</h4>

                <div className="bg-bg-tertiary rounded-lg p-3 space-y-2">
                  <div className="flex items-center gap-3">
                    <Image className="w-5 h-5 text-accent" />
                    <div className="flex-1">
                      <p className="text-sm text-text">Status icons</p>
                      <p className="text-xs text-text-faint">
                        Explorer overlays or Finder badges where available
                      </p>
                    </div>
                    {(status.iconOverlaysAvailable || status.finderBadgesAvailable) && (
                      <CheckCircle className="w-4 h-4 text-success" />
                    )}
                  </div>

                  <div className="flex items-center gap-3">
                    <Terminal className="w-5 h-5 text-accent" />
                    <div className="flex-1">
                      <p className="text-sm text-text">Context Menu</p>
                      <p className="text-xs text-text-faint">
                        SVN commands in native file-manager menus
                      </p>
                    </div>
                    {status.contextMenuAvailable && (
                      <CheckCircle className="w-4 h-4 text-success" />
                    )}
                  </div>
                </div>
              </div>

              {status.helperPath && (
                <div className="bg-bg-secondary rounded-lg p-3 text-xs">
                  <p className="font-medium text-text mb-1">Native helper</p>
                  <p className="text-text-secondary break-all">{status.helperPath}</p>
                  <p className={status.helperExists ? 'text-success mt-1' : 'text-warning mt-1'}>
                    {status.helperExists ? 'Helper found' : 'Helper missing'}
                  </p>
                </div>
              )}

              {status.needsAdmin && !status.registered && (
                <div className="bg-warning/10 border border-warning/30 rounded-lg p-3">
                  <div className="flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 text-warning mt-0.5 flex-shrink-0" />
                    <div className="text-sm text-warning">
                      <p className="font-medium">Administrator Rights May Be Required</p>
                      <p className="mt-1 text-warning/80">
                        Windows shell helper registration can require elevated permissions.
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {error && (
                <div className="bg-error/10 border border-error/30 rounded-lg p-3 text-sm text-error">
                  {error}
                </div>
              )}

              <DetailList title="Repair actions" items={status.repairActions} />
              <DetailList title="Fallback behavior" items={status.limitations} />

              <div className="text-xs text-text-faint bg-bg-secondary rounded-lg p-3">
                <p className="font-medium mb-1">Packaged helper requirements:</p>
                <p>Windows: install a packaged build containing ShellySVNShellHelper.exe</p>
                <p>macOS: install a signed package containing the Finder Sync extension</p>
              </div>
            </>
          )}
        </div>

        <div className="modal-footer">
          <button onClick={() => refetch()} className="btn btn-secondary">
            <RefreshCw className="w-4 h-4" />
            Refresh
          </button>

          {status?.registered ? (
            <button
              onClick={() => unregisterMutation.mutate()}
              disabled={isRegistering}
              className="btn btn-secondary"
            >
              {isRegistering ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <FolderSync className="w-4 h-4" />
              )}
              Unregister
            </button>
          ) : (
            <button
              onClick={() => registerMutation.mutate()}
              disabled={isRegistering || !status?.supported}
              className="btn btn-primary"
            >
              {isRegistering ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Shield className="w-4 h-4" />
              )}
              Register
            </button>
          )}

          <button onClick={onClose} className="btn btn-primary">
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
