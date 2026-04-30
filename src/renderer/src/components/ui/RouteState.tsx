import type { ReactNode } from 'react';
import { AlertCircle, Globe, Inbox, Loader2, WifiOff } from 'lucide-react';

type RouteStateVariant = 'empty' | 'loading' | 'error' | 'offline';

interface RouteStateProps {
  variant: RouteStateVariant;
  title: string;
  description?: string;
  action?: {
    label: string;
    onClick: () => void;
  };
  children?: ReactNode;
  className?: string;
}

const VARIANT_CONFIG = {
  empty: {
    icon: Inbox,
    iconClassName: 'text-text-muted',
    containerClassName: 'bg-bg-tertiary',
    role: 'status',
    live: 'polite',
  },
  loading: {
    icon: Loader2,
    iconClassName: 'text-accent animate-spin',
    containerClassName: 'bg-accent/10',
    role: 'status',
    live: 'polite',
  },
  error: {
    icon: AlertCircle,
    iconClassName: 'text-error',
    containerClassName: 'bg-error/10',
    role: 'alert',
    live: 'assertive',
  },
  offline: {
    icon: WifiOff,
    iconClassName: 'text-warning',
    containerClassName: 'bg-warning/10',
    role: 'status',
    live: 'polite',
  },
} as const;

export function RouteState({
  variant,
  title,
  description,
  action,
  children,
  className = '',
}: RouteStateProps) {
  const config = VARIANT_CONFIG[variant];
  const Icon = variant === 'empty' && title === 'Repository Browser' ? Globe : config.icon;

  return (
    <div
      className={`flex flex-col items-center justify-center h-full text-center p-8 ${className}`}
      role={config.role}
      aria-live={config.live}
      aria-atomic="true"
      aria-label={title}
    >
      <div
        className={`w-16 h-16 rounded-2xl ${config.containerClassName} flex items-center justify-center mb-4`}
        aria-hidden="true"
      >
        <Icon className={`w-8 h-8 ${config.iconClassName}`} />
      </div>
      <h3 className="text-lg font-medium text-text mb-2">{title}</h3>
      {description && <p className="text-sm text-text-secondary max-w-sm mb-4">{description}</p>}
      {children}
      {action && (
        <button type="button" onClick={action.onClick} className="btn btn-secondary">
          {action.label}
        </button>
      )}
    </div>
  );
}
