import { Minus, Moon, Settings, Square, Sun, User, X } from 'lucide-react';

const ICON_BUTTON_CLASS =
  'titlebar-no-drag w-8 h-8 grid place-items-center rounded-lg border transition-fast bg-transparent border-transparent text-text-secondary hover:bg-bg-tertiary hover:border-border hover:text-text';

interface TitlebarControlsProps {
  isWindows: boolean;
  isMaximized: boolean;
  isDarkTheme: boolean;
  accountName: string;
  onToggleTheme: () => void;
  onOpenSettings: () => void;
  onMinimize: () => void;
  onMaximize: () => void;
  onClose: () => void;
}

/** Nonessential titlebar enrichment, loaded after the route shell is usable. */
export function TitlebarControls({
  isWindows,
  isMaximized,
  isDarkTheme,
  accountName,
  onToggleTheme,
  onOpenSettings,
  onMinimize,
  onMaximize,
  onClose,
}: TitlebarControlsProps) {
  const accountInitial = accountName.trim().charAt(0).toUpperCase();

  return (
    <>
      <button
        type="button"
        onClick={onToggleTheme}
        className={ICON_BUTTON_CLASS}
        aria-label={isDarkTheme ? 'Switch to the light theme' : 'Switch to the dark theme'}
        title={isDarkTheme ? 'Switch to the light theme' : 'Switch to the dark theme'}
      >
        {isDarkTheme ? (
          <Sun className="w-4 h-4" aria-hidden="true" />
        ) : (
          <Moon className="w-4 h-4" aria-hidden="true" />
        )}
      </button>

      <button
        type="button"
        onClick={onOpenSettings}
        className={ICON_BUTTON_CLASS}
        aria-label="Settings"
        title="Settings"
      >
        <Settings className="w-4 h-4" aria-hidden="true" />
      </button>

      <button
        type="button"
        onClick={onOpenSettings}
        className="titlebar-no-drag w-[30px] h-[30px] flex-shrink-0 grid place-items-center rounded-full bg-accent text-white text-[12.5px] font-bold transition-fast hover:bg-accent-hover"
        aria-label={accountName ? `Account: ${accountName}` : 'Account — no saved credentials yet'}
        title={accountName || 'No saved credentials yet'}
      >
        {accountInitial || <User className="w-4 h-4" aria-hidden="true" />}
      </button>

      {isWindows && (
        <div className={`flex items-center ml-1 ${isWindows ? 'h-[50px] -mr-3.5' : 'h-full'}`}>
          <button
            type="button"
            onClick={onMinimize}
            className={
              isWindows
                ? 'titlebar-no-drag w-[46px] h-[50px] grid place-items-center text-text-muted hover:bg-bg-tertiary hover:text-text transition-colors duration-100'
                : 'window-control rounded-md hover:bg-bg-elevated transition-fast'
            }
            aria-label="Minimize"
            title="Minimize"
          >
            <Minus
              className={isWindows ? 'w-3 h-3' : 'w-4 h-4'}
              strokeWidth={isWindows ? 1.5 : 2}
              aria-hidden="true"
            />
          </button>
          <button
            type="button"
            onClick={onMaximize}
            className={
              isWindows
                ? 'titlebar-no-drag w-[46px] h-[50px] grid place-items-center text-text-muted hover:bg-bg-tertiary hover:text-text transition-colors duration-100'
                : 'window-control rounded-md hover:bg-bg-elevated transition-fast'
            }
            aria-label={isMaximized ? 'Restore window' : 'Maximize'}
            title={isMaximized ? 'Restore window' : 'Maximize'}
          >
            {isWindows && isMaximized ? (
              <span className="relative block w-3 h-3" aria-hidden="true">
                <span className="absolute left-0 bottom-0 w-[8px] h-[8px] border border-current" />
                <span className="absolute right-0 top-0 w-[8px] h-[8px] border border-current bg-bg-secondary" />
              </span>
            ) : (
              <Square
                className={`w-2.5 h-2.5 ${isMaximized ? 'fill-current' : ''}`}
                strokeWidth={isWindows ? 1.5 : 2}
                aria-hidden="true"
              />
            )}
          </button>
          <button
            type="button"
            onClick={onClose}
            className={
              isWindows
                ? 'titlebar-no-drag w-[46px] h-[50px] grid place-items-center text-text-muted hover:bg-error hover:text-white transition-colors duration-100'
                : 'window-control rounded-md hover:bg-error hover:text-white transition-fast'
            }
            aria-label="Close"
            title="Close"
          >
            <X
              className={isWindows ? 'w-3 h-3' : 'w-4 h-4'}
              strokeWidth={isWindows ? 1.5 : 2}
              aria-hidden="true"
            />
          </button>
        </div>
      )}
    </>
  );
}
