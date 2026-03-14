import { useState } from 'react';
import { X, Key, Plus, FileKey } from 'lucide-react';
import type { ClientCertificate } from '@shared/types';

interface CertificateManagerDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

export function CertificateManagerDialog({ isOpen, onClose }: CertificateManagerDialogProps) {
  // Placeholder - no backend yet
  const [certificates] = useState<ClientCertificate[]>([]);
  const [selectedCertificate, setSelectedCertificate] = useState<ClientCertificate | null>(null);

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
                      <label className="text-xs text-text-muted">Name</label>
                      <p className="text-sm">{selectedCertificate.name}</p>
                    </div>
                    <div>
                      <label className="text-xs text-text-muted">Path</label>
                      <p className="text-sm font-mono text-xs break-all">
                        {selectedCertificate.path}
                      </p>
                    </div>
                    {selectedCertificate.realmPattern && (
                      <div>
                        <label className="text-xs text-text-muted">Realm Pattern</label>
                        <p className="text-sm">{selectedCertificate.realmPattern}</p>
                      </div>
                    )}
                    <div>
                      <label className="text-xs text-text-muted">Passphrase</label>
                      <p className="text-sm">
                        {selectedCertificate.hasPassphrase ? 'Required' : 'Not required'}
                      </p>
                    </div>
                    <div>
                      <label className="text-xs text-text-muted">Created</label>
                      <p className="text-sm">
                        {new Date(selectedCertificate.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                    {selectedCertificate.lastUsedAt && (
                      <div>
                        <label className="text-xs text-text-muted">Last Used</label>
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
          <button
            type="button"
            className="btn btn-primary"
            disabled
            title="Coming soon"
          >
            <Plus className="w-4 h-4" />
            Add Certificate
          </button>
        </div>
      </div>
    </div>
  );
}
