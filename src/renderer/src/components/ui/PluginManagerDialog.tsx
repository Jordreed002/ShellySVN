import { useState, useEffect, useMemo } from 'react';
import {
  X,
  Puzzle,
  Power,
  PowerOff,
  Trash2,
  AlertCircle,
  Check,
  Loader2,
  Play,
  Square,
  ExternalLink,
  Shield,
  Settings,
  Terminal,
} from 'lucide-react';

import { usePlugins, type PluginInstance } from '@renderer/hooks/usePlugins';
import { useFocusTrap } from '@renderer/hooks/useFocusTrap';

interface PluginManagerDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * Get status color and label for a plugin
 */
function getPluginStatus(plugin: PluginInstance): {
  color: string;
  bgColor: string;
  label: string;
} {
  if (plugin.error) {
    return { color: 'bg-error', bgColor: 'bg-error/10', label: 'Error' };
  }
  if (!plugin.enabled) {
    return { color: 'bg-gray-400', bgColor: 'bg-gray-400/10', label: 'Disabled' };
  }
  if (plugin.activated) {
    return { color: 'bg-success', bgColor: 'bg-success/10', label: 'Active' };
  }
  return { color: 'bg-warning', bgColor: 'bg-warning/10', label: 'Inactive' };
}

export function PluginManagerDialog({ isOpen, onClose }: PluginManagerDialogProps) {
  const {
    plugins,
    isLoading,
    setPluginEnabled,
    activatePlugin,
    deactivatePlugin,
    uninstallPlugin,
  } = usePlugins();

  const [selectedPluginId, setSelectedPluginId] = useState<string | null>(null);
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);
  const [showConfirmUninstall, setShowConfirmUninstall] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Focus trap for accessibility
  const modalRef = useFocusTrap({
    active: isOpen,
    onEscape: () => {
      if (!actionInProgress) onClose();
    },
    returnFocus: true,
  });

  // Generate unique IDs for accessibility
  const dialogId = useMemo(() => `plugin-dialog-${Math.random().toString(36).substring(2, 11)}`, []);
  const titleId = `${dialogId}-title`;

  // Selected plugin
  const selectedPlugin = plugins.find((p) => p.manifest.id === selectedPluginId);

  // Reset state when dialog opens
  useEffect(() => {
    if (isOpen) {
      setSelectedPluginId(plugins[0]?.manifest.id ?? null);
      setActionInProgress(null);
      setShowConfirmUninstall(false);
      setSuccessMessage(null);
      setErrorMessage(null);
    }
  }, [isOpen, plugins]);

  // Clear messages after timeout
  useEffect(() => {
    if (successMessage) {
      const timer = setTimeout(() => setSuccessMessage(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [successMessage]);

  const handleEnableDisable = async (plugin: PluginInstance) => {
    const newEnabled = !plugin.enabled;
    setActionInProgress(plugin.manifest.id);

    try {
      await setPluginEnabled(plugin.manifest.id, newEnabled);
      setSuccessMessage(
        newEnabled
          ? `${plugin.manifest.name} enabled successfully`
          : `${plugin.manifest.name} disabled successfully`
      );
    } catch (err) {
      setErrorMessage(`Failed to ${newEnabled ? 'enable' : 'disable'} plugin: ${(err as Error).message}`);
    } finally {
      setActionInProgress(null);
    }
  };

  const handleActivateDeactivate = async (plugin: PluginInstance) => {
    setActionInProgress(plugin.manifest.id);

    try {
      if (plugin.activated) {
        await deactivatePlugin(plugin.manifest.id);
        setSuccessMessage(`${plugin.manifest.name} deactivated`);
      } else {
        await activatePlugin(plugin.manifest.id);
        setSuccessMessage(`${plugin.manifest.name} activated`);
      }
    } catch (err) {
      setErrorMessage(`Failed to ${plugin.activated ? 'deactivate' : 'activate'} plugin: ${(err as Error).message}`);
    } finally {
      setActionInProgress(null);
    }
  };

  const handleUninstall = async () => {
    if (!selectedPlugin) return;

    setActionInProgress(selectedPlugin.manifest.id);
    setShowConfirmUninstall(false);

    try {
      await uninstallPlugin(selectedPlugin.manifest.id);
      setSuccessMessage(`${selectedPlugin.manifest.name} uninstalled successfully`);
      setSelectedPluginId(plugins[0]?.manifest.id ?? null);
    } catch (err) {
      setErrorMessage(`Failed to uninstall plugin: ${(err as Error).message}`);
    } finally {
      setActionInProgress(null);
    }
  };

  const handleClose = () => {
    if (!actionInProgress) {
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={handleClose} role="presentation">
      <div
        ref={modalRef}
        className="modal w-[800px] max-h-[85vh]"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        id={dialogId}
      >
        {/* Header */}
        <div className="modal-header">
          <h2 id={titleId} className="modal-title">
            <Puzzle className="w-5 h-5 text-accent" aria-hidden="true" />
            Plugin Manager
          </h2>
          <button
            onClick={handleClose}
            className="btn-icon-sm"
            disabled={!!actionInProgress}
            aria-label="Close dialog"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        {/* Content */}
        <div className="flex" style={{ height: '500px' }}>
          {/* Left panel - Plugin list */}
          <div
            className="w-[280px] border-r border-border flex flex-col"
            role="region"
            aria-label="Installed plugins"
          >
            <div className="px-3 py-2 border-b border-border bg-bg-tertiary">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-text-secondary uppercase tracking-wider">
                  Plugins ({plugins.length})
                </span>
              </div>
            </div>

            {/* Plugin list */}
            <div className="flex-1 overflow-auto" role="listbox" aria-label="Plugins">
              {isLoading ? (
                <div
                  className="flex items-center justify-center h-20"
                  role="status"
                  aria-label="Loading plugins"
                >
                  <Loader2 className="w-5 h-5 text-text-muted animate-spin" aria-hidden="true" />
                  <span className="sr-only">Loading plugins...</span>
                </div>
              ) : plugins.length === 0 ? (
                <div
                  className="flex flex-col items-center justify-center h-full text-text-muted p-4 text-center"
                  role="status"
                >
                  <Puzzle className="w-8 h-8 mb-2 opacity-50" aria-hidden="true" />
                  <p className="text-sm">No plugins installed</p>
                  <p className="text-xs mt-1 text-text-faint">
                    Plugins extend ShellySVN functionality
                  </p>
                </div>
              ) : (
                plugins.map((plugin, index) => {
                  const status = getPluginStatus(plugin);
                  const isSelected = selectedPluginId === plugin.manifest.id;

                  return (
                    <button
                      key={plugin.manifest.id}
                      onClick={() => setSelectedPluginId(plugin.manifest.id)}
                      disabled={!!actionInProgress}
                      className={`
                        w-full flex items-center gap-2 px-3 py-2 text-left transition-fast
                        ${isSelected ? 'bg-accent/10 border-l-2 border-accent' : 'hover:bg-bg-tertiary border-l-2 border-transparent'}
                      `}
                      role="option"
                      aria-selected={isSelected}
                      aria-posinset={index + 1}
                      aria-setsize={plugins.length}
                    >
                      <div
                        className={`w-2 h-2 rounded-full flex-shrink-0 ${status.color}`}
                        title={status.label}
                        aria-label={status.label}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm text-text truncate" title={plugin.manifest.name}>
                          {plugin.manifest.name}
                        </div>
                        <div className="text-xs text-text-muted truncate" title={plugin.manifest.version}>
                          v{plugin.manifest.version}
                        </div>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {/* Right panel - Plugin details */}
          <div
            className="flex-1 flex flex-col overflow-hidden"
            role="region"
            aria-label="Plugin details"
          >
            {successMessage && (
              <div className="mx-4 mt-4 flex items-center gap-2 text-sm text-success bg-success/10 rounded p-2">
                <Check className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
                <span>{successMessage}</span>
                <button
                  type="button"
                  onClick={() => setSuccessMessage(null)}
                  className="ml-auto text-success hover:text-success/80"
                  aria-label="Dismiss"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            )}

            {errorMessage && (
              <div
                className="mx-4 mt-4 flex items-center gap-2 text-sm text-error bg-error/10 rounded p-2"
                role="alert"
                aria-live="assertive"
              >
                <AlertCircle className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
                <span>{errorMessage}</span>
                <button
                  type="button"
                  onClick={() => setErrorMessage(null)}
                  className="ml-auto text-error hover:text-error/80"
                  aria-label="Dismiss"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            )}

            {selectedPlugin ? (
              <div className="flex-1 overflow-auto p-4 space-y-4">
                {/* Plugin header */}
                <div className="bg-bg-tertiary rounded-lg p-4">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-accent/20 flex items-center justify-center">
                        <Puzzle className="w-5 h-5 text-accent" aria-hidden="true" />
                      </div>
                      <div>
                        <h3 className="text-lg font-medium text-text">{selectedPlugin.manifest.name}</h3>
                        <div className="flex items-center gap-2 text-sm text-text-muted">
                          <span>v{selectedPlugin.manifest.version}</span>
                          {selectedPlugin.manifest.author && (
                            <>
                              <span>by {selectedPlugin.manifest.author}</span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                    {(() => {
                      const status = getPluginStatus(selectedPlugin);
                      return (
                        <span
                          className={`px-2 py-1 text-xs font-medium rounded ${status.bgColor} text-text`}
                        >
                          {status.label}
                        </span>
                      );
                    })()}
                  </div>

                  {selectedPlugin.manifest.description && (
                    <p className="mt-3 text-sm text-text-secondary">
                      {selectedPlugin.manifest.description}
                    </p>
                  )}

                  {/* Links */}
                  {(selectedPlugin.manifest.homepage || selectedPlugin.manifest.repository) && (
                    <div className="mt-3 flex items-center gap-3">
                      {selectedPlugin.manifest.homepage && (
                        <a
                          href={selectedPlugin.manifest.homepage}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-accent hover:text-accent/80 flex items-center gap-1"
                        >
                          <ExternalLink className="w-3 h-3" aria-hidden="true" />
                          Homepage
                        </a>
                      )}
                      {selectedPlugin.manifest.repository && (
                        <a
                          href={selectedPlugin.manifest.repository}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-accent hover:text-accent/80 flex items-center gap-1"
                        >
                          <ExternalLink className="w-3 h-3" aria-hidden="true" />
                          Repository
                        </a>
                      )}
                    </div>
                  )}
                </div>

                {/* Error display */}
                {selectedPlugin.error && (
                  <div className="bg-error/10 border border-error/20 rounded-lg p-4">
                    <h4 className="text-sm font-medium text-error flex items-center gap-2 mb-2">
                      <AlertCircle className="w-4 h-4" aria-hidden="true" />
                      Plugin Error
                    </h4>
                    <p className="text-sm text-error/90 font-mono break-words">
                      {selectedPlugin.error}
                    </p>
                  </div>
                )}

                {/* Permissions */}
                {selectedPlugin.manifest.permissions.length > 0 && (
                  <div className="bg-bg-elevated border border-border rounded-lg p-4">
                    <h4 className="text-sm font-medium text-text flex items-center gap-2 mb-3">
                      <Shield className="w-4 h-4 text-text-muted" aria-hidden="true" />
                      Permissions
                    </h4>
                    <div className="flex flex-wrap gap-2">
                      {selectedPlugin.manifest.permissions.map((perm) => (
                        <span
                          key={perm}
                          className="px-2 py-1 text-xs rounded bg-bg-tertiary text-text-secondary font-mono"
                        >
                          {perm}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Hooks */}
                {selectedPlugin.manifest.hooks.length > 0 && (
                  <div className="bg-bg-elevated border border-border rounded-lg p-4">
                    <h4 className="text-sm font-medium text-text flex items-center gap-2 mb-3">
                      <Terminal className="w-4 h-4 text-text-muted" aria-hidden="true" />
                      Hooks
                    </h4>
                    <div className="flex flex-wrap gap-2">
                      {selectedPlugin.manifest.hooks.map((hook) => (
                        <span
                          key={hook}
                          className="px-2 py-1 text-xs rounded bg-bg-tertiary text-text-secondary font-mono"
                        >
                          {hook}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Commands contributed */}
                {selectedPlugin.manifest.contributes?.commands &&
                  selectedPlugin.manifest.contributes.commands.length > 0 && (
                    <div className="bg-bg-elevated border border-border rounded-lg p-4">
                      <h4 className="text-sm font-medium text-text flex items-center gap-2 mb-3">
                        <Terminal className="w-4 h-4 text-text-muted" aria-hidden="true" />
                        Commands
                      </h4>
                      <div className="space-y-2">
                        {selectedPlugin.manifest.contributes.commands.map((cmd) => (
                          <div
                            key={cmd.id}
                            className="flex items-center justify-between text-sm"
                          >
                            <span className="text-text">{cmd.title}</span>
                            <span className="text-text-muted font-mono text-xs">
                              {selectedPlugin.manifest.id}.{cmd.id}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                {/* Settings contributed */}
                {selectedPlugin.manifest.contributes?.settings &&
                  selectedPlugin.manifest.contributes.settings.length > 0 && (
                    <div className="bg-bg-elevated border border-border rounded-lg p-4">
                      <h4 className="text-sm font-medium text-text flex items-center gap-2 mb-3">
                        <Settings className="w-4 h-4 text-text-muted" aria-hidden="true" />
                        Settings
                      </h4>
                      <div className="space-y-2">
                        {selectedPlugin.manifest.contributes.settings.map((setting) => (
                          <div key={setting.key} className="text-sm">
                            <span className="text-text font-mono">{setting.key}</span>
                            {setting.description && (
                              <p className="text-xs text-text-muted mt-0.5">
                                {setting.description}
                              </p>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                {/* Actions */}
                <div className="space-y-2">
                  <h3 className="text-sm font-medium text-text-secondary">Actions</h3>

                  {/* Enable/Disable */}
                  <button
                    type="button"
                    onClick={() => handleEnableDisable(selectedPlugin)}
                    disabled={!!actionInProgress}
                    className={`w-full flex items-center gap-3 p-3 rounded-lg border transition-fast text-left group disabled:opacity-50 disabled:cursor-not-allowed ${
                      selectedPlugin.enabled
                        ? 'border-warning/30 bg-warning/5 hover:bg-warning/10'
                        : 'border-success/30 bg-success/5 hover:bg-success/10'
                    }`}
                  >
                    {actionInProgress === selectedPlugin.manifest.id ? (
                      <Loader2 className="w-5 h-5 text-text-muted animate-spin" aria-hidden="true" />
                    ) : selectedPlugin.enabled ? (
                      <PowerOff className="w-5 h-5 text-warning" aria-hidden="true" />
                    ) : (
                      <Power className="w-5 h-5 text-success" aria-hidden="true" />
                    )}
                    <div>
                      <div
                        className={`text-sm font-medium ${
                          selectedPlugin.enabled ? 'text-warning' : 'text-success'
                        }`}
                      >
                        {actionInProgress === selectedPlugin.manifest.id
                          ? 'Processing...'
                          : selectedPlugin.enabled
                            ? 'Disable Plugin'
                            : 'Enable Plugin'}
                      </div>
                      <div className="text-xs text-text-muted">
                        {selectedPlugin.enabled
                          ? 'Stop the plugin from being activated automatically'
                          : 'Allow the plugin to be activated'}
                      </div>
                    </div>
                  </button>

                  {/* Activate/Deactivate */}
                  {selectedPlugin.enabled && (
                    <button
                      type="button"
                      onClick={() => handleActivateDeactivate(selectedPlugin)}
                      disabled={!!actionInProgress}
                      className={`w-full flex items-center gap-3 p-3 rounded-lg border transition-fast text-left group disabled:opacity-50 disabled:cursor-not-allowed ${
                        selectedPlugin.activated
                          ? 'border-warning/30 bg-warning/5 hover:bg-warning/10'
                          : 'border-accent/30 bg-accent/5 hover:bg-accent/10'
                      }`}
                    >
                      {actionInProgress === selectedPlugin.manifest.id ? (
                        <Loader2 className="w-5 h-5 text-text-muted animate-spin" aria-hidden="true" />
                      ) : selectedPlugin.activated ? (
                        <Square className="w-5 h-5 text-warning" aria-hidden="true" />
                      ) : (
                        <Play className="w-5 h-5 text-accent" aria-hidden="true" />
                      )}
                      <div>
                        <div
                          className={`text-sm font-medium ${
                            selectedPlugin.activated ? 'text-warning' : 'text-accent'
                          }`}
                        >
                          {actionInProgress === selectedPlugin.manifest.id
                            ? 'Processing...'
                            : selectedPlugin.activated
                              ? 'Deactivate Plugin'
                              : 'Activate Plugin'}
                        </div>
                        <div className="text-xs text-text-muted">
                          {selectedPlugin.activated
                            ? 'Stop the plugin from running'
                            : 'Start running the plugin now'}
                        </div>
                      </div>
                    </button>
                  )}

                  {/* Uninstall */}
                  <button
                    type="button"
                    onClick={() => setShowConfirmUninstall(true)}
                    disabled={!!actionInProgress}
                    className="w-full flex items-center gap-3 p-3 rounded-lg border border-error/30 bg-error/5 hover:bg-error/10 transition-fast text-left group disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {actionInProgress === selectedPlugin.manifest.id ? (
                      <Loader2 className="w-5 h-5 text-error animate-spin" aria-hidden="true" />
                    ) : (
                      <Trash2 className="w-5 h-5 text-error" aria-hidden="true" />
                    )}
                    <div>
                      <div className="text-sm font-medium text-error">
                        {actionInProgress === selectedPlugin.manifest.id
                          ? 'Uninstalling...'
                          : 'Uninstall Plugin'}
                      </div>
                      <div className="text-xs text-text-muted">
                        Remove this plugin from ShellySVN
                      </div>
                    </div>
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex-1 flex items-center justify-center text-text-muted">
                <div className="text-center">
                  <Puzzle className="w-8 h-8 mx-auto mb-2 opacity-50" aria-hidden="true" />
                  <p className="text-sm">Select a plugin to view details</p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="modal-footer">
          <div className="flex-1 text-sm text-text-faint">
            {plugins.length} plugin{plugins.length !== 1 ? 's' : ''} installed
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="btn btn-secondary"
            disabled={!!actionInProgress}
          >
            Close
          </button>
        </div>

        {/* Confirmation dialog for uninstall */}
        {showConfirmUninstall && selectedPlugin && (
          <div
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
            role="dialog"
            aria-modal="true"
            aria-labelledby="uninstall-confirm-title"
          >
            <div className="bg-bg-elevated rounded-lg shadow-xl w-[400px] p-4">
              <h3
                id="uninstall-confirm-title"
                className="text-lg font-medium text-text mb-2 flex items-center gap-2"
              >
                <Trash2 className="w-5 h-5 text-error" aria-hidden="true" />
                Confirm Uninstall
              </h3>
              <p className="text-sm text-text-secondary mb-4">
                Are you sure you want to uninstall{' '}
                <strong className="text-text">{selectedPlugin.manifest.name}</strong>? This action
                cannot be undone.
              </p>
              <div className="bg-error/10 border border-error/20 rounded p-3 mb-4">
                <p className="text-xs text-error">
                  The plugin will be completely removed from ShellySVN along with all its settings.
                </p>
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowConfirmUninstall(false)}
                  className="btn btn-secondary"
                >
                  Cancel
                </button>
                <button type="button" onClick={handleUninstall} className="btn btn-danger">
                  <Trash2 className="w-4 h-4" />
                  Uninstall
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
