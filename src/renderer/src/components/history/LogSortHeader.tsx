import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import type { LogSortKey, LogSortState } from '@renderer/utils/logFilters';

/**
 * Sortable column headers for log surfaces (#66). Clicking a header either
 * flips the active direction or switches to that column's natural default
 * (revision/date newest-first, author/message A→Z). The chosen sort is
 * persisted per working copy by `useLogViewState`.
 */

const ALL_COLUMNS: LogSortKey[] = ['revision', 'date', 'author', 'message'];

const COLUMN_LABELS: Record<LogSortKey, string> = {
  revision: 'Revision',
  date: 'Date',
  author: 'Author',
  message: 'Message',
};

export interface LogSortHeaderProps {
  sort: LogSortState;
  onToggle: (key: LogSortKey) => void;
  /** Columns to offer; defaults to all four. */
  columns?: readonly LogSortKey[];
  className?: string;
}

export function LogSortHeader({ sort, onToggle, columns, className = '' }: LogSortHeaderProps) {
  const keys = columns && columns.length > 0 ? columns : ALL_COLUMNS;

  return (
    <div
      role="row"
      className={`flex items-center gap-3 border-b border-border bg-bg-secondary px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-text-faint ${className}`}
    >
      {keys.map((key) => {
        const active = sort.key === key;
        const Icon = !active ? ArrowUpDown : sort.direction === 'asc' ? ArrowUp : ArrowDown;
        return (
          <button
            key={key}
            type="button"
            onClick={() => onToggle(key)}
            aria-pressed={active}
            aria-label={
              active
                ? `Sorted by ${COLUMN_LABELS[key].toLowerCase()}, ${
                    sort.direction === 'asc' ? 'ascending' : 'descending'
                  }`
                : `Sort by ${COLUMN_LABELS[key].toLowerCase()}`
            }
            className={`inline-flex items-center gap-1 uppercase transition-colors hover:text-text ${
              active ? 'text-accent' : ''
            } ${key === 'revision' || key === 'author' ? 'flex-none' : ''} ${
              key === 'date' ? 'ml-auto flex-none' : ''
            } ${key === 'message' ? 'min-w-0 flex-1 text-left' : ''}`}
            title={`Sort by ${COLUMN_LABELS[key].toLowerCase()}`}
          >
            <span className={key === 'message' ? 'truncate' : ''}>{COLUMN_LABELS[key]}</span>
            <Icon className="h-3 w-3" aria-hidden="true" />
          </button>
        );
      })}
    </div>
  );
}
