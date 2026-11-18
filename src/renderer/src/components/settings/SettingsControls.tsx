/**
 * Shared controls for the settings panels.
 *
 * Every settings tab builds from the same small set of rows so spacing, type
 * and states line up across the dialog: a checkbox row with an optional hint,
 * a labelled field, a native select with the shared chevron, a segmented
 * choice, an inline number with its unit, and a tone-coded notice. They are
 * presentation only; the panels keep owning state and persistence.
 */

import {
  useId,
  type ChangeEvent,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
} from 'react';
import { AlertTriangle, CheckCircle2, ChevronDown, Info, Loader2, XCircle } from 'lucide-react';

// --------------------------------------------
// Checkbox row
// --------------------------------------------

interface SettingsCheckboxProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: ReactNode;
  hint?: ReactNode;
  disabled?: boolean;
  /** Explicit accessible name when `label` is not plain text. */
  ariaLabel?: string;
  testId?: string;
}

export function SettingsCheckbox({
  checked,
  onChange,
  label,
  hint,
  disabled,
  ariaLabel,
  testId,
}: SettingsCheckboxProps) {
  const hintId = useId();
  return (
    <label
      className={`settings-check group ${disabled ? 'cursor-not-allowed opacity-55' : 'cursor-pointer'}`}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="checkbox mt-0.5 shrink-0"
        aria-label={ariaLabel}
        aria-describedby={hint ? hintId : undefined}
        data-testid={testId}
      />
      <span className="min-w-0">
        <span className="block text-13 text-text">{label}</span>
        {hint && (
          <span id={hintId} className="mt-0.5 block text-12 text-text-muted">
            {hint}
          </span>
        )}
      </span>
    </label>
  );
}

/** Vertical stack of checkbox rows with consistent rhythm. */
export function SettingsCheckList({ children }: { children: ReactNode }) {
  return <div className="space-y-0.5">{children}</div>;
}

// --------------------------------------------
// Labelled field
// --------------------------------------------

interface SettingsFieldProps {
  label: ReactNode;
  /** Id of the control the label names. Omit when the label wraps nothing focusable. */
  htmlFor?: string;
  hint?: ReactNode;
  error?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function SettingsField({ label, htmlFor, hint, error, children, className }: SettingsFieldProps) {
  return (
    <div className={className}>
      {htmlFor ? (
        <label htmlFor={htmlFor} className="settings-label">
          {label}
        </label>
      ) : (
        <span className="settings-label">{label}</span>
      )}
      <div className="mt-1.5">{children}</div>
      {error ? (
        <p className="mt-1.5 text-12 text-error" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="settings-hint mt-1.5">{hint}</p>
      ) : null}
    </div>
  );
}

// --------------------------------------------
// Select
// --------------------------------------------

type SettingsSelectProps = SelectHTMLAttributes<HTMLSelectElement> & {
  children: ReactNode;
  wrapperClassName?: string;
};

export function SettingsSelect({
  children,
  className = '',
  wrapperClassName = '',
  ...props
}: SettingsSelectProps) {
  return (
    <div className={`relative ${wrapperClassName}`}>
      <select
        {...props}
        className={`input settings-select appearance-none pr-9 ${className}`}
      >
        {children}
      </select>
      <ChevronDown
        className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted"
        aria-hidden="true"
      />
    </div>
  );
}

// --------------------------------------------
// Segmented choice
// --------------------------------------------

export interface SegmentOption<T> {
  value: T;
  label: string;
  icon?: ReactNode;
}

interface SettingsSegmentedProps<T> {
  options: readonly SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  ariaLabel: string;
  /** Taller tiles with the icon above the label (theme picker). */
  size?: 'default' | 'tile';
}

export function SettingsSegmented<T extends string | number | boolean>({
  options,
  value,
  onChange,
  ariaLabel,
  size = 'default',
}: SettingsSegmentedProps<T>) {
  return (
    <div className="settings-segmented" role="group" aria-label={ariaLabel}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={String(option.value)}
            type="button"
            aria-pressed={selected}
            onClick={() => onChange(option.value)}
            className={`settings-segment ${size === 'tile' ? 'settings-segment-tile' : ''}`}
          >
            {option.icon}
            <span>{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}

// --------------------------------------------
// Inline number with unit
// --------------------------------------------

type SettingsNumberProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'onChange'> & {
  onValueChange: (raw: string) => void;
  unit?: ReactNode;
  widthClassName?: string;
};

export function SettingsNumber({
  onValueChange,
  unit,
  widthClassName = 'w-24',
  className = '',
  ...props
}: SettingsNumberProps) {
  return (
    <span className="inline-flex items-center gap-2">
      <input
        {...props}
        type="number"
        onChange={(event: ChangeEvent<HTMLInputElement>) => onValueChange(event.target.value)}
        className={`input ${widthClassName} tabular-nums ${className}`}
      />
      {unit && <span className="text-12 text-text-muted">{unit}</span>}
    </span>
  );
}

/** A label on the left and a compact control on the right. */
export function SettingsInlineRow({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: ReactNode;
  htmlFor?: string;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-1">
      <div className="min-w-0">
        {htmlFor ? (
          <label htmlFor={htmlFor} className="block text-13 text-text">
            {label}
          </label>
        ) : (
          <span className="block text-13 text-text">{label}</span>
        )}
        {hint && <span className="mt-0.5 block text-12 text-text-muted">{hint}</span>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

// --------------------------------------------
// Notice
// --------------------------------------------

type NoticeTone = 'neutral' | 'pending' | 'success' | 'warning' | 'error';

const NOTICE_ICON: Record<NoticeTone, ReactNode> = {
  neutral: <Info className="h-4 w-4" aria-hidden="true" />,
  pending: <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />,
  success: <CheckCircle2 className="h-4 w-4" aria-hidden="true" />,
  warning: <AlertTriangle className="h-4 w-4" aria-hidden="true" />,
  error: <XCircle className="h-4 w-4" aria-hidden="true" />,
};

interface SettingsNoticeProps {
  tone: NoticeTone;
  title?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  role?: 'alert' | 'status';
  testId?: string;
  icon?: ReactNode;
}

export function SettingsNotice({
  tone,
  title,
  children,
  action,
  role,
  testId,
  icon,
}: SettingsNoticeProps) {
  return (
    <div
      className={`settings-notice settings-notice-${tone}`}
      role={role}
      aria-live={role === 'status' ? 'polite' : undefined}
      data-testid={testId}
    >
      <span className="settings-notice-icon">{icon ?? NOTICE_ICON[tone]}</span>
      <div className="min-w-0 flex-1">
        {title && <p className="text-13 font-medium">{title}</p>}
        {children && (
          <div className={`text-12 text-text-secondary ${title ? 'mt-0.5' : ''}`}>{children}</div>
        )}
      </div>
      {action && <div className="shrink-0 self-center">{action}</div>}
    </div>
  );
}

// --------------------------------------------
// Lists
// --------------------------------------------

/** Bordered list whose rows are separated by hairlines rather than gaps. */
export function SettingsList({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <ul className="settings-list" aria-label={label}>
      {children}
    </ul>
  );
}

export function SettingsEmpty({
  icon,
  title,
  children,
}: {
  icon?: ReactNode;
  title: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="settings-empty">
      {icon && <span className="text-text-faint">{icon}</span>}
      <div className="min-w-0">
        <p className="text-13 text-text-secondary">{title}</p>
        {children && <p className="mt-0.5 text-12 text-text-muted">{children}</p>}
      </div>
    </div>
  );
}
