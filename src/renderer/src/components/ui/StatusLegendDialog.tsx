/**
 * StatusLegendDialog (#94) — the overlay legend for every Subversion status the
 * app displays. i18n pilot surface (#134): all prose renders through
 * `useTranslation()`; the English catalog (`i18n/locales/en.ts`) holds the
 * strings byte-identical to their pre-i18n literals, and
 * `i18n/__tests__/pilot.test.tsx` freezes that identity.
 *
 * The statuses and their colors are not re-invented here: the letters come from
 * `SvnStatusChar` (@shared/types) and the words and colors from `STATUS_CONFIG`
 * (components/ui/StatusIcon.tsx), the same mapping the file lists and status
 * pills render with. The plain-language meaning and the actions that apply live
 * in the message catalog under `statusLegend.entry.<segment>.*`, so
 * `STATUS_LEGEND` stays typed `Record<SvnStatusChar, …>` — adding a status
 * letter without documenting it fails the build (and the test).
 *
 * Opened from the status bar's help button and from the command palette's
 * "What the status colors mean" action; both go through
 * `STATUS_LEGEND_OPEN_EVENT`, which the mounted dialog listens for.
 */

import { useEffect, useState } from 'react';
import type { SvnStatusChar } from '@shared/types';
import { useTranslation } from '../../i18n';
import { DialogBase } from './DialogBase';
import { STATUS_CONFIG } from './StatusIcon';

/** Firing this event opens the legend wherever `<StatusLegendDialogMount />` is mounted. */
export const STATUS_LEGEND_OPEN_EVENT = 'shellysvn:open-status-legend';

export interface StatusLegendEntry {
  /** The status letter `svn status` prints; '' for "no modifications". */
  code: string;
  /** Subversion's own word, from STATUS_CONFIG. */
  label: string;
  /** Background token for the color chip, from STATUS_CONFIG. */
  chipClass: string;
  /** Foreground token for the letter, from STATUS_CONFIG. */
  textClass: string;
  /** Message key for the plain-language meaning (catalog: statusLegend.entry.*). */
  meaning: string;
  /** Message key for what you can do about it, in Subversion's vocabulary. */
  actions: string;
}

/** Catalog key segment per status letter; punctuation letters get worded names. */
const ENTRY_KEY_SEGMENT: Record<SvnStatusChar, string> = {
  ' ': 'none',
  A: 'A',
  C: 'C',
  D: 'D',
  I: 'I',
  M: 'M',
  R: 'R',
  X: 'X',
  '?': 'question',
  '!': 'missing',
  '~': 'obstructed',
  O: 'O',
};

/** One legend entry: colors and words from STATUS_CONFIG, message keys from here. */
function entry(status: SvnStatusChar): StatusLegendEntry {
  const config = STATUS_CONFIG[status];
  const segment = ENTRY_KEY_SEGMENT[status];
  return {
    code: config.code,
    label: config.label,
    chipClass: config.bgColor,
    textClass: config.color,
    meaning: `statusLegend.entry.${segment}.meaning`,
    actions: `statusLegend.entry.${segment}.actions`,
  };
}

/**
 * Every status the app displays, documented. The `Record<SvnStatusChar, …>`
 * type is the completeness contract: a new letter in the shared union breaks
 * the build until it is explained here (and given catalog entries).
 */
export const STATUS_LEGEND: Record<SvnStatusChar, StatusLegendEntry> = {
  ' ': entry(' '),
  A: entry('A'),
  C: entry('C'),
  D: entry('D'),
  I: entry('I'),
  M: entry('M'),
  R: entry('R'),
  X: entry('X'),
  '?': entry('?'),
  '!': entry('!'),
  '~': entry('~'),
  O: entry('O'),
};

export interface StatusLegendDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

/** The legend itself: every status, its color, its meaning, its actions. */
export function StatusLegendDialog({ isOpen, onClose }: StatusLegendDialogProps) {
  const { t } = useTranslation();
  return (
    <DialogBase
      isOpen={isOpen}
      onClose={onClose}
      title={t('statusLegend.title')}
      dialogId="status-legend"
      className="w-[560px] max-w-[92vw] flex flex-col"
    >
      <div className="modal-body min-h-0 overflow-y-auto scrollbar-overlay">
        <p className="mb-3 text-12 text-text-secondary">
          {t('statusLegend.intro.lead')} <span className="code">svn status</span>{' '}
          {t('statusLegend.intro.tail')}
        </p>
        <ul className="list-none">
          {(Object.keys(STATUS_LEGEND) as SvnStatusChar[]).map((status) => {
            const item = STATUS_LEGEND[status];
            return (
              <li
                key={status}
                className="flex items-start gap-3 border-b border-border-muted py-2.5 last:border-b-0"
              >
                <span
                  aria-hidden="true"
                  className={`mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-6 font-mono text-11 font-semibold ${item.chipClass} ${item.textClass}`}
                >
                  {item.code || '·'}
                </span>
                <div className="min-w-0">
                  <h3 className="text-12.5 font-semibold text-text">
                    {item.label}
                    {item.code && (
                      <span className="ml-1.5 font-mono text-10 font-normal text-text-faint">
                        svn status {item.code}
                      </span>
                    )}
                  </h3>
                  <p className="mt-0.5 text-11.5 leading-relaxed text-text-secondary">
                    {t(item.meaning)}
                  </p>
                  <p className="mt-0.5 text-10.5 text-text-faint">{t(item.actions)}</p>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </DialogBase>
  );
}

/**
 * Mounted once (the status bar). Owns the open state: the dialog opens from
 * the help button or from `STATUS_LEGEND_OPEN_EVENT` (the command palette's
 * route in), and closes on any of the usual DialogBase exits.
 */
export function StatusLegendDialogMount() {
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    const open = () => setIsOpen(true);
    window.addEventListener(STATUS_LEGEND_OPEN_EVENT, open);
    return () => window.removeEventListener(STATUS_LEGEND_OPEN_EVENT, open);
  }, []);

  return <StatusLegendDialog isOpen={isOpen} onClose={() => setIsOpen(false)} />;
}
