import type { FormEvent } from 'react';
import { Key, Lock, Shield, User } from 'lucide-react';
import { DialogBase } from '@renderer/components/ui/DialogBase';

export interface SslCertificate {
  fingerprint: string;
  subject?: string;
  issuer?: string;
  validFrom?: string;
  validUntil?: string;
}

interface CheckoutSslPromptProps {
  certificate: SslCertificate;
  failures: string[];
  trustPermanently: boolean;
  onTrustPermanentlyChange: (trusted: boolean) => void;
  onReject: () => void;
  onTrust: () => void;
}

export function CheckoutSslPrompt({
  certificate,
  failures,
  trustPermanently,
  onTrustPermanentlyChange,
  onReject,
  onTrust,
}: CheckoutSslPromptProps) {
  return (
    <DialogBase
      isOpen
      onClose={onReject}
      dialogId="checkout-ssl-prompt"
      className="w-[480px]"
      showCloseButton={false}
      closeOnOverlayClick={false}
      title={
        <>
          <Shield className="w-5 h-5 text-warning" />
          Certificate Verification Failed
        </>
      }
    >
      <div className="modal-body space-y-4">
          <p className="text-text-secondary text-sm">
            The server's SSL certificate could not be verified. Review the certificate details
            below:
          </p>

          <div className="bg-surface-elevated rounded-lg p-4 space-y-2 font-mono text-xs">
            {certificate.subject && (
              <div className="flex">
                <span className="text-text-faint w-24">Subject:</span>
                <span className="text-text break-all">{certificate.subject}</span>
              </div>
            )}
            {certificate.issuer && (
              <div className="flex">
                <span className="text-text-faint w-24">Issuer:</span>
                <span className="text-text break-all">{certificate.issuer}</span>
              </div>
            )}
            {certificate.validFrom && (
              <div className="flex">
                <span className="text-text-faint w-24">Valid from:</span>
                <span className="text-text">{certificate.validFrom}</span>
              </div>
            )}
            {certificate.validUntil && (
              <div className="flex">
                <span className="text-text-faint w-24">Valid until:</span>
                <span className="text-text">{certificate.validUntil}</span>
              </div>
            )}
            <div className="flex">
              <span className="text-text-faint w-24">Fingerprint:</span>
              <span className="text-text break-all">{certificate.fingerprint}</span>
            </div>
          </div>

          {failures.length > 0 && (
            <div className="text-warning text-sm space-y-1">
              <p className="font-medium">Issues:</p>
              <ul className="list-disc list-inside text-text-secondary">
                {failures.includes('untrusted-issuer') && (
                  <li>Certificate is not issued by a trusted authority</li>
                )}
                {failures.includes('hostname-mismatch') && (
                  <li>Certificate hostname does not match</li>
                )}
                {failures.includes('expired') && <li>Certificate has expired</li>}
                {failures.includes('not-yet-valid') && <li>Certificate is not yet valid</li>}
              </ul>
            </div>
          )}

          <label
            htmlFor="checkout-trust-permanently"
            className="flex items-center gap-2 text-sm cursor-pointer"
          >
            <input
              id="checkout-trust-permanently"
              type="checkbox"
              checked={trustPermanently}
              onChange={(event) => onTrustPermanentlyChange(event.target.checked)}
              className="checkbox"
            />
            <span>Trust this certificate permanently</span>
          </label>
        </div>

        <div className="modal-footer">
          <button type="button" onClick={onReject} className="btn btn-secondary">
            Reject
          </button>
          <button type="button" onClick={onTrust} className="btn btn-warning">
            <Shield className="w-4 h-4" />
            Trust Certificate
          </button>
        </div>
    </DialogBase>
  );
}

interface CheckoutAuthPromptProps {
  realm: string | null;
  username: string;
  password: string;
  onUsernameChange: (username: string) => void;
  onPasswordChange: (password: string) => void;
  onCancel: () => void;
  onSubmit: (event: FormEvent) => void;
}

export function CheckoutAuthPrompt({
  realm,
  username,
  password,
  onUsernameChange,
  onPasswordChange,
  onCancel,
  onSubmit,
}: CheckoutAuthPromptProps) {
  return (
    <DialogBase
      isOpen
      onClose={onCancel}
      dialogId="checkout-auth-prompt"
      className="w-[400px]"
      showCloseButton={false}
      closeOnOverlayClick={false}
      initialFocus="first-control"
      title={
        <>
          <Lock className="w-5 h-5 text-accent" />
          Authentication Required
        </>
      }
    >
      <form onSubmit={onSubmit}>
        <div className="modal-body space-y-4">
          <p className="text-text-secondary text-sm">Please enter your credentials for:</p>

            {realm && (
              <div className="bg-surface-elevated rounded px-3 py-2 text-sm text-text-secondary font-mono">
                {realm}
              </div>
            )}

            <div>
              <label
                htmlFor="checkout-auth-username"
                className="text-sm font-medium text-text-secondary mb-1.5 block flex items-center gap-2"
              >
                <User className="w-4 h-4" />
                Username <span className="text-error">*</span>
              </label>
              <input
                id="checkout-auth-username"
                type="text"
                value={username}
                onChange={(event) => onUsernameChange(event.target.value)}
                placeholder="Enter username"
                className="input"
              />
            </div>

            <div>
              <label
                htmlFor="checkout-auth-password"
                className="text-sm font-medium text-text-secondary mb-1.5 block flex items-center gap-2"
              >
                <Key className="w-4 h-4" />
                Password
              </label>
              <input
                id="checkout-auth-password"
                type="password"
                value={password}
                onChange={(event) => onPasswordChange(event.target.value)}
                placeholder="Enter password"
                className="input"
              />
            </div>
          </div>

          <div className="modal-footer">
            <button type="button" onClick={onCancel} className="btn btn-secondary">
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={!username.trim()}>
              <Lock className="w-4 h-4" />
              Authenticate
            </button>
          </div>
        </form>
    </DialogBase>
  );
}
