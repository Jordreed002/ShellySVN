/**
 * i18n pilot (#134) — en byte-identity: the two pilot surfaces (StatusLegendDialog,
 * routes/files) render under `en` exactly the literals they had before t().
 * The FROZEN map below is hand-copied from the pre-migration sources; if a
 * catalog edit drifts from it, this file fails. The pseudo-locale block proves
 * the surfaces really resolve through t() (not baked-in constants).
 */

import '@testing-library/jest-dom';
import React from 'react';
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StatusLegendDialog } from '../../components/ui/StatusLegendDialog';
import { PSEUDO_LOCALE, depseudoLocalize, pseudoLocaleCatalog } from '../pseudo';
import { __resetI18nForTests, registerCatalog, setLocale, t } from '../index';
import { en } from '../locales/en';

/** The pre-i18n literals, frozen. key → exact string as rendered before #134. */
const FROZEN: Record<string, string> = {
  'statusLegend.title': 'What the status colors mean',
  'statusLegend.intro.lead': 'Every letter',
  'statusLegend.intro.tail': 'can report about a working copy, with the color this app shows it in.',
  'statusLegend.entry.none.meaning':
    'Versioned, unmodified, and in step with BASE — nothing to do.',
  'statusLegend.entry.none.actions': 'No action needed.',
  'statusLegend.entry.A.meaning':
    'Scheduled for addition — a new file or folder waiting for its first commit.',
  'statusLegend.entry.A.actions': 'Commit to send it to the repository, or Revert to unschedule it.',
  'statusLegend.entry.C.meaning':
    'A merge or update changed the same lines you did. Subversion refuses to commit until it is resolved.',
  'statusLegend.entry.C.actions': 'Resolve (pick a side or merge by hand), then Commit.',
  'statusLegend.entry.D.meaning':
    'Scheduled for deletion from the repository. The local file is already gone.',
  'statusLegend.entry.D.actions': 'Commit to record the deletion, or Revert to restore the file.',
  'statusLegend.entry.I.meaning': 'Matched by an ignore pattern, so Subversion skips it entirely.',
  'statusLegend.entry.I.actions': 'Edit ignore patterns to change what is skipped.',
  'statusLegend.entry.M.meaning': 'Changed locally against BASE — the everyday working state.',
  'statusLegend.entry.M.actions': 'Diff to review, Commit to keep, Revert to discard.',
  'statusLegend.entry.R.meaning':
    'Deleted and re-added in one step — the item keeps its path but starts a new history.',
  'statusLegend.entry.R.actions': 'Commit to record the replacement.',
  'statusLegend.entry.X.meaning':
    'Pulled in from another repository by an svn:externals definition.',
  'statusLegend.entry.X.actions': 'Update fetches it; the externals manager edits the definition.',
  'statusLegend.entry.question.meaning':
    'On disk but not under version control — Subversion will neither commit nor revert it.',
  'statusLegend.entry.question.actions': 'Add to bring it under version control, or ignore it.',
  'statusLegend.entry.missing.meaning':
    'Versioned, but the file or folder is not on disk — moved or deleted outside Subversion.',
  'statusLegend.entry.missing.actions': 'Revert to restore it, or Delete to schedule its removal.',
  'statusLegend.entry.obstructed.meaning':
    'Something of a different kind is in the way — for example a file sitting where a folder is versioned.',
  'statusLegend.entry.obstructed.actions': 'Clear the obstruction, or Delete and re-Add the item.',
  'statusLegend.entry.O.meaning':
    'Exists in the repository but not on disk — this spot is only visited by a sparse checkout.',
  'statusLegend.entry.O.actions': 'Update with the right depth to pull it in.',
  'routes.files.title': 'File Explorer',
};

beforeEach(() => {
  __resetI18nForTests();
});

afterEach(() => {
  __resetI18nForTests();
});

describe('pilot: en output is byte-identical to the pre-i18n literals', () => {
  it('the en catalog carries every frozen string exactly', () => {
    expect(Object.keys(FROZEN)).toHaveLength(28);
    for (const [key, literal] of Object.entries(FROZEN)) {
      expect(t(key), key).toBe(literal);
    }
  });

  it('StatusLegendDialog renders the frozen strings (no provider, default locale)', () => {
    render(<StatusLegendDialog isOpen onClose={vi.fn()} />);

    expect(screen.getByText(FROZEN['statusLegend.title'])).toBeInTheDocument();
    // Intro sentence reassembles to the original text: lead + code span + tail.
    // (The span splits the <p>'s own text nodes, so match the paragraph and
    // assert on its full textContent.)
    const intro = screen.getByText(/^Every letter/);
    expect(intro).toHaveTextContent(
      /^Every letter svn status can report about a working copy, with the color this app shows it in\.$/
    );
    for (const [key, literal] of Object.entries(FROZEN)) {
      if (key.startsWith('statusLegend.entry.')) {
        expect(screen.getByText(literal), key).toBeInTheDocument();
      }
    }
  });

  it('the files route label is the frozen literal', () => {
    expect(t('routes.files.title')).toBe('File Explorer');
  });
});

describe('pilot: the surfaces resolve through t(), not constants', () => {
  it('switching to the pseudo locale re-renders pseudo-localized text', async () => {
    registerCatalog(PSEUDO_LOCALE, pseudoLocaleCatalog(en));
    const { rerender } = render(<StatusLegendDialog isOpen onClose={vi.fn()} />);
    expect(screen.getByText(FROZEN['statusLegend.title'])).toBeInTheDocument();

    await act(async () => {
      await setLocale(PSEUDO_LOCALE, { persist: false });
    });
    rerender(<StatusLegendDialog isOpen onClose={vi.fn()} />);

    // Every pseudo string is bracket-wrapped; find the dialog title by decoding.
    const pseudoTexts = screen
      .getAllByText(/^\[.*\]$/)
      .map((element) => element.textContent ?? '');
    const title = pseudoTexts.find((text) => depseudoLocalize(text) === FROZEN['statusLegend.title']);
    expect(title, 'dialog title should render pseudo-localized').toBeDefined();
    expect(title).not.toBe(FROZEN['statusLegend.title']);
    expect(screen.queryByText(FROZEN['statusLegend.title'])).not.toBeInTheDocument();
  });
});
