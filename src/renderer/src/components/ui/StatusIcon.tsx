import type { SvnStatusChar } from '@shared/types';
import {
  Check,
  Plus,
  AlertTriangle,
  Trash2,
  EyeOff,
  FileEdit,
  RefreshCw,
  Link,
  HelpCircle,
  FileX,
  AlertCircle,
  Cloud,
} from 'lucide-react';

/**
 * Status indicators — the prototype's `.flag` (`prototypes/12-browser.html`).
 *
 * One vocabulary, Subversion's own: every flag shows the **word and the letter
 * together** — `Modified M`, `Conflicted C` — so the character people see in
 * `svn status` output is always tied to its meaning. A conflict is the one
 * status that fills rather than tints, because a conflict stops work.
 */

interface StatusIconConfig {
  icon: React.ComponentType<{ className?: string }>;
  /** Foreground token. */
  color: string;
  /** Tint token. */
  bgColor: string;
  /** Hairline pill: border, tint and foreground together. */
  tone: string;
  /** The word Subversion uses. */
  label: string;
  /** The letter `svn status` prints. Empty for an unmodified item. */
  code: string;
}

const STATUS_CONFIG: Record<SvnStatusChar, StatusIconConfig> = {
  ' ': {
    icon: Check,
    color: 'text-svn-normal',
    bgColor: 'bg-svn-normal/20',
    tone: 'border-border bg-bg-tertiary text-text-secondary',
    label: 'Normal',
    code: '',
  },
  A: {
    icon: Plus,
    color: 'text-svn-added',
    bgColor: 'bg-svn-added/20',
    tone: 'border-svn-added/40 bg-svn-added/10 text-svn-added',
    label: 'Added',
    code: 'A',
  },
  C: {
    icon: AlertTriangle,
    color: 'text-svn-conflict',
    bgColor: 'bg-svn-conflict/20',
    tone: 'border-svn-conflict bg-svn-conflict text-white',
    label: 'Conflicted',
    code: 'C',
  },
  D: {
    icon: Trash2,
    color: 'text-svn-deleted',
    bgColor: 'bg-svn-deleted/20',
    tone: 'border-svn-deleted/40 bg-svn-deleted/10 text-svn-deleted',
    label: 'Deleted',
    code: 'D',
  },
  I: {
    icon: EyeOff,
    color: 'text-svn-ignored',
    bgColor: 'bg-svn-ignored/20',
    tone: 'border-svn-ignored/40 bg-svn-ignored/10 text-svn-ignored',
    label: 'Ignored',
    code: 'I',
  },
  M: {
    icon: FileEdit,
    color: 'text-svn-modified',
    bgColor: 'bg-svn-modified/20',
    tone: 'border-svn-modified/40 bg-svn-modified/10 text-svn-modified',
    label: 'Modified',
    code: 'M',
  },
  R: {
    icon: RefreshCw,
    color: 'text-svn-replaced',
    bgColor: 'bg-svn-replaced/20',
    tone: 'border-svn-replaced/40 bg-svn-replaced/10 text-svn-replaced',
    label: 'Replaced',
    code: 'R',
  },
  X: {
    icon: Link,
    color: 'text-svn-external',
    bgColor: 'bg-svn-external/20',
    tone: 'border-svn-external/40 bg-svn-external/10 text-svn-external',
    label: 'External',
    code: 'X',
  },
  '?': {
    icon: HelpCircle,
    color: 'text-svn-unversioned',
    bgColor: 'bg-svn-unversioned/20',
    tone: 'border-svn-unversioned/40 bg-svn-unversioned/10 text-svn-unversioned',
    label: 'Unversioned',
    code: '?',
  },
  '!': {
    icon: FileX,
    color: 'text-svn-missing',
    bgColor: 'bg-svn-missing/20',
    tone: 'border-svn-missing/40 bg-svn-missing/10 text-svn-missing',
    label: 'Missing',
    code: '!',
  },
  '~': {
    icon: AlertCircle,
    color: 'text-svn-obstructed',
    bgColor: 'bg-svn-obstructed/20',
    tone: 'border-svn-obstructed/40 bg-svn-obstructed/10 text-svn-obstructed',
    label: 'Obstructed',
    code: '~',
  },
  O: {
    icon: Cloud,
    color: 'text-info',
    bgColor: 'bg-info/20',
    tone: 'border-info/40 bg-info/10 text-info',
    label: 'Not checked out',
    code: 'O',
  },
};

/** `.flag` — hairline pill, tabular gap, never wraps. */
const FLAG_BASE =
  'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border font-semibold leading-none';

/** `Modified — svn status M`, for the title attribute. */
function statusTitle(config: StatusIconConfig): string {
  return config.code ? `${config.label} — svn status ${config.code}` : config.label;
}

interface StatusIconProps {
  status: SvnStatusChar;
  size?: 'sm' | 'md' | 'lg';
  showLabel?: boolean;
  className?: string;
  /** Accessible label (falls back to status label) */
  ariaLabel?: string;
}

/**
 * A status as a pill. With `showLabel` it reads `Modified M`; without it, the
 * glyph and the bare letter, for columns with no room for the word.
 */
export function StatusIcon({
  status,
  size = 'md',
  showLabel = false,
  className = '',
  ariaLabel,
}: StatusIconProps) {
  const config = STATUS_CONFIG[status] || STATUS_CONFIG[' '];
  const Icon = config.icon;

  const pillSizes = {
    sm: 'h-5 px-1.5 text-[10px]',
    md: 'h-[22px] px-2 text-[11px]',
    lg: 'h-6 px-2.5 text-[12.5px]',
  };

  const iconSizes = {
    sm: 'w-2.5 h-2.5',
    md: 'w-[11px] h-[11px]',
    lg: 'w-3.5 h-3.5',
  };

  return (
    <span
      className={`${FLAG_BASE} ${pillSizes[size]} ${config.tone} ${
        status === 'C' ? 'animate-pulse-subtle' : ''
      } ${className}`}
      role="img"
      aria-label={ariaLabel || config.label}
      title={statusTitle(config)}
    >
      <Icon className={`${iconSizes[size]} flex-shrink-0`} />
      {showLabel && <span>{config.label}</span>}
      {config.code && (
        <span className={`font-mono font-medium ${showLabel ? 'opacity-70' : ''}`}>
          {config.code}
        </span>
      )}
    </span>
  );
}

// Compact status dot for table columns
export function StatusDot({
  status,
  className = '',
  /** Accessible label (falls back to status label) */
  ariaLabel,
}: {
  status: SvnStatusChar;
  className?: string;
  ariaLabel?: string;
}) {
  const config = STATUS_CONFIG[status] || STATUS_CONFIG[' '];

  const dotColors: Record<SvnStatusChar, string> = {
    ' ': 'bg-svn-normal',
    A: 'bg-svn-added',
    C: 'bg-svn-conflict animate-pulse-subtle',
    D: 'bg-svn-deleted',
    I: 'bg-svn-ignored',
    M: 'bg-svn-modified',
    R: 'bg-svn-replaced',
    X: 'bg-svn-external',
    '?': 'bg-svn-unversioned',
    '!': 'bg-svn-missing',
    '~': 'bg-svn-obstructed',
    O: 'bg-info',
  };

  return (
    <div
      className={`
        w-2 h-2 rounded-full flex-shrink-0 ring-2 ring-bg-secondary
        ${dotColors[status]}
        ${className}
      `}
      role="img"
      aria-label={ariaLabel || config.label}
      title={statusTitle(config)}
    />
  );
}

/**
 * The full flag: the word and the letter together, in a hairline pill. This is
 * the default shape a status takes anywhere there is room for it.
 */
export function StatusBadge({
  status,
  className = '',
  /** Accessible label (falls back to status label) */
  ariaLabel,
}: {
  status: SvnStatusChar;
  className?: string;
  ariaLabel?: string;
}) {
  const config = STATUS_CONFIG[status] || STATUS_CONFIG[' '];

  return (
    <span
      className={`${FLAG_BASE} h-[22px] px-2 text-[11px] ${config.tone} ${className}`}
      role="status"
      aria-label={ariaLabel || config.label}
      title={statusTitle(config)}
    >
      <span>{config.label}</span>
      {config.code && <span className="font-mono font-medium opacity-70">{config.code}</span>}
    </span>
  );
}

export { STATUS_CONFIG };
