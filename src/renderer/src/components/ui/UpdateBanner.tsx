import { useEffect, useState } from 'react';
import { Download, ExternalLink, Loader2, RefreshCw, ShieldCheck, X } from 'lucide-react';
import { formatBytes } from '@shared/utils/formatBytes';
import { useAppUpdater } from '@renderer/hooks/useAppUpdater';

export function UpdateBanner() {
  const { state, download, cancelDownload } = useAppUpdater();
  const [dismissedVersion, setDismissedVersion] = useState<string | null>(null);
  const [installBlocked, setInstallBlocked] = useState(false);

  const availableVersion = state && 'availableVersion' in state ? state.availableVersion : null;
  useEffect(() => {
    if (availableVersion && availableVersion !== dismissedVersion) setInstallBlocked(false);
  }, [availableVersion, dismissedVersion]);

  if (
    !state ||
    (state.status !== 'available' &&
      state.status !== 'downloading' &&
      state.status !== 'downloaded')
  ) {
    return null;
  }
  if (state.status === 'available' && dismissedVersion === state.availableVersion) return null;

  const openNotes = () => {
    if ('releaseUrl' in state && state.releaseUrl)
      void window.api.app.openExternal(state.releaseUrl);
  };
  const restart = async () => {
    setInstallBlocked(false);
    const result = await window.api.updater.restartAndInstall();
    if (!result.started && result.reason === 'svn-operation-active') setInstallBlocked(true);
  };

  return (
    <section
      className="relative z-10 flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-accent/30 bg-accent/[0.07] px-4 py-2.5 text-sm shadow-card"
      aria-live="polite"
      aria-label="Application update"
    >
      <div className="grid h-8 w-8 flex-none place-items-center rounded-lg border border-accent/30 bg-accent/10 text-accent">
        {state.status === 'downloading' ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        ) : state.status === 'downloaded' ? (
          <ShieldCheck className="h-4 w-4" aria-hidden="true" />
        ) : (
          <Download className="h-4 w-4" aria-hidden="true" />
        )}
      </div>

      <div className="min-w-0 flex-1">
        <p className="font-semibold text-text">
          {state.status === 'downloaded'
            ? `ShellySVN ${state.availableVersion} is ready`
            : state.status === 'downloading'
              ? `Downloading ShellySVN ${state.availableVersion}`
              : `ShellySVN ${state.availableVersion} is available`}
        </p>
        <p className="truncate text-xs text-text-muted">
          {state.status === 'downloading'
            ? `${Math.round(state.percent)}% · ${formatBytes(state.transferred)} of ${formatBytes(state.total)} · ${formatBytes(state.bytesPerSecond)}/s`
            : state.status === 'downloaded'
              ? installBlocked
                ? 'Finish or cancel the active SVN operation before restarting.'
                : 'Restart now, or the update will install when ShellySVN closes.'
              : state.releaseNotes ||
                `${state.channel === 'preview' ? 'Preview' : 'Stable'} release`}
        </p>
        {state.status === 'downloading' ? (
          <div
            className="mt-1.5 h-1 overflow-hidden rounded-full bg-bg-elevated"
            aria-hidden="true"
          >
            <div
              className="h-full rounded-full bg-accent transition-[width] duration-300"
              style={{ width: `${Math.max(0, Math.min(100, state.percent))}%` }}
            />
          </div>
        ) : null}
      </div>

      <div className="flex flex-none items-center gap-2">
        {'releaseUrl' in state && state.releaseUrl ? (
          <button type="button" className="btn btn-ghost" onClick={openNotes}>
            <ExternalLink className="h-4 w-4" />
            Release notes
          </button>
        ) : null}
        {state.status === 'available' ? (
          <>
            <button type="button" className="btn btn-primary" onClick={() => void download()}>
              <Download className="h-4 w-4" />
              Download update
            </button>
            <button
              type="button"
              className="btn-icon-sm"
              aria-label="Remind me later"
              title="Later"
              onClick={() => setDismissedVersion(state.availableVersion)}
            >
              <X className="h-4 w-4" />
            </button>
          </>
        ) : state.status === 'downloading' ? (
          <button type="button" className="btn btn-secondary" onClick={() => void cancelDownload()}>
            Cancel download
          </button>
        ) : (
          <button type="button" className="btn btn-primary" onClick={() => void restart()}>
            <RefreshCw className="h-4 w-4" />
            Restart and install
          </button>
        )}
      </div>
    </section>
  );
}
