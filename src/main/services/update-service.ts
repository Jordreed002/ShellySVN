import { app, BrowserWindow } from 'electron';
import { appendFile, chmod, rename, stat } from 'fs/promises';
import { join } from 'path';
import electronUpdater, {
  type ProgressInfo,
  type UpdateDownloadedEvent,
  type UpdateInfo,
} from 'electron-updater';
import type { AppUpdateState, UpdateChannel } from '@shared/types';
import { getSettingsManager } from '../settings-manager';
import { hasActiveWorkingCopyMutations } from './svn-mutation-queue';
import { hasActiveSvnProgressOperations } from './svn-progress';
import { sendToRenderer } from '../utils/safe-renderer-send';

const { autoUpdater, CancellationToken } = electronUpdater;
const DOWNLOADS_URL = 'https://github.com/Jordreed002/ShellySVN/releases/latest';
const STARTUP_DELAY_MS = 15_000;
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1_000;
const MAX_LOG_BYTES = 1_000_000;

type CheckSource = 'scheduled' | 'manual';

function normalizeReleaseNotes(notes: UpdateInfo['releaseNotes']): string | undefined {
  if (!notes) return undefined;
  const text = Array.isArray(notes)
    ? notes
        .map((entry) => entry.note)
        .filter(Boolean)
        .join('\n\n')
    : notes;
  return (
    text
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 2_000) || undefined
  );
}

function safeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error || 'Unknown updater error');
  return message
    .replace(/https?:\/\/\S+/gi, '[update server]')
    .replace(/^(?:headers?|set-cookie|cookie|x-api-key)\s*:.*$/gim, '[redacted header]')
    .replace(/[A-Za-z]:\\[^\s]+/g, '[local path]')
    .replace(/(^|\s)\/[A-Za-z0-9._~!$&'()+,;=:@%/-]+/g, '$1[local path]')
    .replace(/(authorization|token|password|cookie)\s*[:=]\s*\S+/gi, '$1=[redacted]')
    .slice(0, 500);
}

function classifyError(
  error: unknown
): Pick<Extract<AppUpdateState, { status: 'error' }>, 'code' | 'retryable'> {
  const message = (error instanceof Error ? error.message : String(error ?? '')).toLowerCase();
  if (/cancel/.test(message)) return { code: 'cancelled', retryable: true };
  if (/signature|code sign|not signed/.test(message))
    return { code: 'signature', retryable: false };
  if (/sha|checksum|digest/.test(message)) return { code: 'checksum', retryable: true };
  if (/access|permission|eperm|eacces/.test(message))
    return { code: 'permission', retryable: false };
  if (/network|timeout|timed out|enotfound|econn|http|socket/.test(message)) {
    return { code: 'network', retryable: true };
  }
  return { code: 'unknown', retryable: true };
}

function updateDetails(info: UpdateInfo | UpdateDownloadedEvent) {
  return {
    availableVersion: info.version,
    releaseName: info.releaseName ?? undefined,
    releaseDate: info.releaseDate,
    releaseNotes: normalizeReleaseNotes(info.releaseNotes),
    releaseUrl: `https://github.com/Jordreed002/ShellySVN/releases/tag/v${encodeURIComponent(info.version)}`,
  };
}

export class UpdateService {
  private state: AppUpdateState;
  private availableInfo: UpdateInfo | null = null;
  private checkPromise: Promise<AppUpdateState> | null = null;
  private downloadPromise: Promise<AppUpdateState> | null = null;
  private cancellationToken: InstanceType<typeof CancellationToken> | null = null;
  private startupTimer: ReturnType<typeof setTimeout> | null = null;
  private intervalTimer: ReturnType<typeof setInterval> | null = null;
  private currentSource: CheckSource | 'download' | 'install' = 'scheduled';
  private logPromise: Promise<void> = Promise.resolve();
  private initialized = false;
  private installStarted = false;
  private beforeInstallQuit?: () => void | Promise<void>;

  constructor() {
    const channel = getSettingsManager().getSettings().updateChannel ?? 'stable';
    this.state = this.initialState(channel);
  }

  private eligibility(): Extract<AppUpdateState, { status: 'unsupported' }> | null {
    const base = {
      status: 'unsupported' as const,
      installedVersion: app.getVersion(),
      channel: this.channel(),
      manualDownloadUrl: DOWNLOADS_URL,
    };
    if (!app.isPackaged) return { ...base, reason: 'unpackaged' };
    if (process.platform === 'linux' && !process.env.APPIMAGE) {
      return { ...base, reason: 'unsupported-format' };
    }
    if (
      process.platform === 'win32' &&
      (process.env.PORTABLE_EXECUTABLE_DIR || process.env.PORTABLE_EXECUTABLE_FILE)
    ) {
      return { ...base, reason: 'unsupported-format' };
    }
    if (!['win32', 'darwin', 'linux'].includes(process.platform)) {
      return { ...base, reason: 'unsupported-format' };
    }
    return null;
  }

  private channel(): UpdateChannel {
    return getSettingsManager().getSettings().updateChannel ?? 'stable';
  }

  private initialState(channel: UpdateChannel): AppUpdateState {
    const unsupported = this.eligibility();
    if (unsupported) return unsupported;
    return { status: 'idle', installedVersion: app.getVersion(), channel };
  }

  private base() {
    return { installedVersion: app.getVersion(), channel: this.channel() };
  }

  private setState(state: AppUpdateState): AppUpdateState {
    this.state = state;
    for (const window of BrowserWindow.getAllWindows()) {
      sendToRenderer(window.webContents, 'updater:state', state);
    }
    void this.log(
      `${state.status}${'availableVersion' in state ? ` ${state.availableVersion}` : ''}`
    );
    return state;
  }

  private async log(message: string): Promise<void> {
    const safeMessage = safeErrorMessage(message);
    this.logPromise = this.logPromise
      .then(async () => {
        const logPath = join(app.getPath('logs'), 'updater.log');
        try {
          const details = await stat(logPath);
          if (details.size >= MAX_LOG_BYTES) await rename(logPath, `${logPath}.1`);
        } catch {
          // The log is created on first write.
        }
        await appendFile(logPath, `${new Date().toISOString()} ${safeMessage}\n`, {
          encoding: 'utf8',
          mode: 0o600,
        });
        if (process.platform !== 'win32') await chmod(logPath, 0o600);
      })
      .catch(() => undefined);
    await this.logPromise;
  }

  private errorState(error: unknown, source = this.currentSource): AppUpdateState {
    const classified = classifyError(error);
    return this.setState({
      status: 'error',
      ...this.base(),
      ...classified,
      message: safeErrorMessage(error),
      source,
    });
  }

  async initialize(onBeforeInstallQuit?: () => void | Promise<void>): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
    this.beforeInstallQuit = onBeforeInstallQuit;

    const settings = getSettingsManager();
    await settings.ready();
    const unsupported = this.eligibility();
    if (unsupported) {
      this.setState(unsupported);
      return;
    }

    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.fullChangelog = false;

    autoUpdater.on('checking-for-update', () => {
      this.setState({ status: 'checking', ...this.base() });
    });
    autoUpdater.on('update-available', (info) => {
      this.availableInfo = info;
      this.setState({ status: 'available', ...this.base(), ...updateDetails(info) });
    });
    autoUpdater.on('update-not-available', () => {
      this.availableInfo = null;
      this.setState({ status: 'upToDate', ...this.base() });
    });
    autoUpdater.on('download-progress', (progress: ProgressInfo) => {
      if (!this.availableInfo) return;
      this.setState({
        status: 'downloading',
        ...this.base(),
        availableVersion: this.availableInfo.version,
        percent: progress.percent,
        transferred: progress.transferred,
        total: progress.total,
        bytesPerSecond: progress.bytesPerSecond,
      });
    });
    autoUpdater.on('update-downloaded', (info) => {
      this.availableInfo = info;
      this.cancellationToken = null;
      this.setState({ status: 'downloaded', ...this.base(), ...updateDetails(info) });
    });
    autoUpdater.on('update-cancelled', () => {
      this.cancellationToken = null;
      if (this.availableInfo) {
        this.setState({
          status: 'available',
          ...this.base(),
          ...updateDetails(this.availableInfo),
        });
      } else {
        this.setState({ status: 'idle', ...this.base() });
      }
    });
    autoUpdater.on('error', (error) => this.errorState(error));
    settings.addListener(() => {
      if (
        this.state.channel !== this.channel() &&
        this.state.status !== 'downloading' &&
        this.state.status !== 'downloaded'
      ) {
        this.setState({ status: 'idle', ...this.base() });
      }
      this.configureSchedule();
    });
    this.configureSchedule();
  }

  private configureSchedule(): void {
    if (this.startupTimer) clearTimeout(this.startupTimer);
    if (this.intervalTimer) clearInterval(this.intervalTimer);
    this.startupTimer = null;
    this.intervalTimer = null;
    if (!getSettingsManager().getSettings().checkUpdatesOnStartup || this.eligibility()) return;

    this.startupTimer = setTimeout(() => {
      void this.check('scheduled');
      this.intervalTimer = setInterval(() => void this.check('scheduled'), CHECK_INTERVAL_MS);
    }, STARTUP_DELAY_MS);
  }

  getState(): AppUpdateState {
    const unsupported = this.eligibility();
    if (unsupported) return unsupported;
    if (
      this.state.channel !== this.channel() &&
      this.state.status !== 'downloading' &&
      this.state.status !== 'downloaded'
    ) {
      return this.setState({ status: 'idle', ...this.base() });
    }
    return this.state;
  }

  check(source: CheckSource = 'manual'): Promise<AppUpdateState> {
    const unsupported = this.eligibility();
    if (unsupported) return Promise.resolve(this.setState(unsupported));
    if (this.checkPromise) return this.checkPromise;
    if (this.downloadPromise) return this.downloadPromise;

    this.currentSource = source;
    autoUpdater.allowPrerelease = this.channel() === 'preview';
    autoUpdater.allowDowngrade = false;
    this.checkPromise = autoUpdater
      .checkForUpdates()
      .then(() => this.state)
      .catch((error) => this.errorState(error, source))
      .finally(() => {
        this.checkPromise = null;
      });
    return this.checkPromise;
  }

  download(): Promise<AppUpdateState> {
    if (this.downloadPromise) return this.downloadPromise;
    if (this.checkPromise) return this.checkPromise.then(() => this.download());
    if (!this.availableInfo || this.state.status !== 'available')
      return Promise.resolve(this.state);

    this.currentSource = 'download';
    const cancellationToken = new CancellationToken();
    this.cancellationToken = cancellationToken;
    this.downloadPromise = autoUpdater
      .downloadUpdate(cancellationToken)
      .then(() => this.state)
      .catch((error) => {
        if (cancellationToken.cancelled) {
          return this.availableInfo
            ? this.setState({
                status: 'available',
                ...this.base(),
                ...updateDetails(this.availableInfo),
              })
            : this.setState({ status: 'idle', ...this.base() });
        }
        return this.errorState(error, 'download');
      })
      .finally(() => {
        this.downloadPromise = null;
        this.cancellationToken = null;
      });
    return this.downloadPromise;
  }

  cancelDownload(): AppUpdateState {
    this.cancellationToken?.cancel();
    return this.state;
  }

  restartAndInstall(): import('@shared/types').RestartAndInstallResult {
    const unsupported = this.eligibility();
    if (unsupported) return { started: false, reason: 'unsupported' };
    if (this.state.status !== 'downloaded') return { started: false, reason: 'not-downloaded' };
    if (hasActiveWorkingCopyMutations() || hasActiveSvnProgressOperations()) {
      return { started: false, reason: 'svn-operation-active' };
    }
    if (this.installStarted) return { started: true };
    this.installStarted = true;
    this.currentSource = 'install';
    void Promise.resolve(this.beforeInstallQuit?.())
      .then(() => autoUpdater.quitAndInstall(false, true))
      .catch((error) => {
        this.installStarted = false;
        this.errorState(error, 'install');
      });
    return { started: true };
  }

  dispose(): void {
    if (this.startupTimer) clearTimeout(this.startupTimer);
    if (this.intervalTimer) clearInterval(this.intervalTimer);
    this.cancellationToken?.cancel();
  }
}

let updateService: UpdateService | null = null;

export function getUpdateService(): UpdateService {
  updateService ??= new UpdateService();
  return updateService;
}
