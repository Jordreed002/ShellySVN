import { useEffect, useState } from 'react';
import { X, Key, Plus, FileKey, Trash2 } from 'lucide-react';
import type { ClientCertificate, SvnNativeAuthEntry } from '@shared/types';
import { confirmAppAction } from '../../utils/dialogs';

interface CertificateManagerDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

export function CertificateManagerDialog({ isOpen, onClose }: CertificateManagerDialogProps) {
  // Placeholder - no backend yet
  const [certificates] = useState<ClientCertificate[]>([]);
  const [selectedCertificate, setSelectedCertificate] = useState<ClientCertificate | null>(null);
  const [nativeEntries, setNativeEntries] = useState<SvnNativeAuthEntry[]>([]);
  const [nativeError, setNativeError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    window.api.svn.nativeAuth.list().then(setNativeEntries).catch((error) => {
      setNativeError((error as Error).message || 'Failed to read native SVN credentials');
    });
  }, [isOpen]);

  const removeNativeEntry = async (entry: SvnNativeAuthEntry) => {
    if (!(await confirmAppAction({
      type: 'warning',
      message: `Remove native SVN authentication entry for "${entry.realm}"?`,
      confirmLabel: 'Remove',
    }))) return;
    await window.api.svn.nativeAuth.remove([entry.realm]);
    setNativeEntries(await window.api.svn.nativeAuth.list());
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal w-[600px] max-h-[70vh]" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="flex items-center gap-2">
            <Key className="w-5 h-5" />
            <h2>SSL Certificates</h2>
          </div>
          <button type="button" onClick={onClose} className="btn-ghost btn-sm">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="modal-body">
          <section className="mb-5">
            <h3 className="mb-2 text-sm font-medium text-text">Native SVN authentication cache</h3>
            {nativeError && <p className="text-sm text-error">{nativeError}</p>}
            {!nativeError && nativeEntries.length === 0 && (
              <p className="text-sm text-text-muted">No native SVN credentials are cached.</p>
            )}
            <div className="space-y-2">
              {nativeEntries.map((entry) => (
                <div key={`${entry.kind}:${entry.realm}:${entry.username || ''}`} className="flex items-center justify-between rounded border border-border p-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm text-text">{entry.realm}</div>
                    <div className="text-xs text-text-muted">
                      {entry.kind}{entry.username ? ` · ${entry.username}` : ''}
                    </div>
                  </div>
                  <button type="button" className="btn-icon-sm text-error" onClick={() => removeNativeEntry(entry)} title="Remove cached authentication entry">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          </section>
          {certificates.length === 0 ? (
            <div className="text-center py-8 text-text-secondary">
              <FileKey className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p>No certificates configured</p>
              <p className="text-sm mt-2">
                Client SSL certificates are used for HTTPS repository authentication.
              </p>
            </div>
          ) : (
            <div className="flex gap-4 min-h-[300px]">
              {/* Certificate List */}
              <div className="w-1/2 border border-border rounded-lg overflow-hidden">
                <div className="bg-bg-tertiary px-3 py-2 border-b border-border">
                  <span className="text-sm font-medium text-text-secondary">Certificates</span>
                </div>
                <div className="divide-y divide-border max-h-[250px] overflow-y-auto">
                  {certificates.map((cert) => (
                    <button
                      key={cert.id}
                      type="button"
                      onClick={() => setSelectedCertificate(cert)}
                      className={`w-full text-left px-3 py-2 transition-fast ${
                        selectedCertificate?.id === cert.id
                          ? 'bg-accent/10 border-l-2 border-accent'
                          : 'hover:bg-bg-tertiary'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <FileKey className="w-4 h-4 text-text-muted" />
                        <span className="text-sm font-medium truncate">{cert.name}</span>
                      </div>
                      {cert.realmPattern && (
                        <p className="text-xs text-text-muted mt-0.5 truncate">
                          {cert.realmPattern}
                        </p>
                      )}
                    </button>
                  ))}
                </div>
              </div>

              {/* Certificate Details */}
              <div className="w-1/2 border border-border rounded-lg overflow-hidden">
                <div className="bg-bg-tertiary px-3 py-2 border-b border-border">
                  <span className="text-sm font-medium text-text-secondary">Details</span>
                </div>
                {selectedCertificate ? (
                  <div className="p-3 space-y-3">
                    <div>
                      <div className="text-xs text-text-muted">Name</div>
                      <p className="text-sm">{selectedCertificate.name}</p>
                    </div>
                    <div>
                      <div className="text-xs text-text-muted">Path</div>
                      <p className="text-sm font-mono text-xs break-all">
                        {selectedCertificate.path}
                      </p>
                    </div>
                    {selectedCertificate.realmPattern && (
                      <div>
                        <div className="text-xs text-text-muted">Realm Pattern</div>
                        <p className="text-sm">{selectedCertificate.realmPattern}</p>
                      </div>
                    )}
                    <div>
                      <div className="text-xs text-text-muted">Passphrase</div>
                      <p className="text-sm">
                        {selectedCertificate.hasPassphrase ? 'Required' : 'Not required'}
                      </p>
                    </div>
                    <div>
                      <div className="text-xs text-text-muted">Created</div>
                      <p className="text-sm">
                        {new Date(selectedCertificate.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                    {selectedCertificate.lastUsedAt && (
                      <div>
                        <div className="text-xs text-text-muted">Last Used</div>
                        <p className="text-sm">
                          {new Date(selectedCertificate.lastUsedAt).toLocaleDateString()}
                        </p>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="p-3 text-center text-text-muted text-sm">
                    Select a certificate to view details
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button type="button" onClick={onClose} className="btn btn-secondary">
            Close
          </button>
          <button type="button" className="btn btn-primary" disabled title="Coming soon">
            <Plus className="w-4 h-4" />
            Add Certificate
          </button>
        </div>
      </div>
    </div>
  );
}
