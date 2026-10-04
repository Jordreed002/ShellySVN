import { AxeBuilder } from '@axe-core/playwright';
import { test, expect } from '../helpers/electron-fixture';
import type { ElectronApplication, Page } from '@playwright/test';

/*
 * Accessibility audits (#129) — structural Playwright checks PLUS full axe
 * scans (`@axe-core/playwright`, Track A item 7) on the same screens the
 * visual-regression suite captures.
 *
 * Structural checks stay: they prove runtime behavior axe cannot see (focus
 * containment, focus restoration, visible focus indicator). The axe audits
 * prove the static tree: roles, names, labels, contrast, hierarchy.
 *
 * Determinism mirrors `visual-regression.spec.ts` (fixed window bounds,
 * reduced motion, dark color scheme, settled skeletons) so both suites see
 * the same render. Any `disableRules` below must carry a justification
 * comment — the default answer is "fix the app, don't disable the rule".
 */

// Same pinning as visual-regression: layout must not depend on the host screen.
const WINDOW_BOUNDS = { width: 1280, height: 800 };

/** Pin everything the host machine would otherwise decide for us. */
async function stabilize(electronApp: ElectronApplication, page: Page): Promise<void> {
  await electronApp.evaluate(({ BrowserWindow }, bounds) => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) {
      win.setBounds({ x: 40, y: 40, width: bounds.width, height: bounds.height });
    }
  }, WINDOW_BOUNDS);

  // Settings-dependent chrome first (status bar attaches, skeletons resolve);
  // the onboarding tutorial's visibility is decided by the same reads.
  await expect(page.locator('div[role="status"][aria-label="Application status"]')).toBeAttached({
    timeout: 10000,
  });
  await expect(page.locator('.skeleton-shimmer')).toHaveCount(0, { timeout: 10000 });

  const closeTutorialButton = page.getByLabel('Close tutorial');
  if (await closeTutorialButton.isVisible()) {
    await closeTutorialButton.click();
    await expect(closeTutorialButton).toBeHidden({ timeout: 5000 });
  }

  // 'system' theme follows the OS; reduced motion is the app's own kill-switch.
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);
}

/**
 * Standard axe pattern: inject, scan, assert no violations. Scoping (via the
 * builder passed in) keeps each audit about the surface under test; failures
 * print one line per violation so the report is actionable.
 *
 * setLegacyMode: axe's default flow finishes the run in a BLANK page opened
 * via browserContext.newPage(), which Electron's Playwright context does not
 * support ("Target.createTarget: Not supported"). Legacy mode runs axe.run()
 * entirely in the target page instead; its only restriction is that
 * cross-origin iframes are not audited — the app renders none, so the two
 * modes are equivalent here.
 *
 * Exclusions: ONLY for already-reported violations that live in renderer
 * app code (not owned by this suite's authors). Every exclusion carries its
 * reason; anything NOT excluded fails the suite, so new regressions surface
 * immediately and fixed items can drop off the lists below.
 */
interface AxeRuleExclusion {
  rule: string;
  why: string;
}

async function expectNoAxeViolations(
  builder: AxeBuilder,
  context: string,
  exclusions: AxeRuleExclusion[] = []
): Promise<void> {
  builder.setLegacyMode();
  // One call for all rules: AxeBuilder#disableRules resets its rules map on
  // every invocation, so per-rule calls would keep only the last one.
  if (exclusions.length > 0) {
    builder.disableRules(exclusions.map((exclusion) => exclusion.rule));
  }
  const results = await builder.analyze();
  const violations = results.violations;
  if (violations.length > 0) {
    const summary = violations
      .map(
        (violation) =>
          `  [${violation.id}] ${violation.help} (${violation.nodes.length} nodes)\n` +
          violation.nodes
            .slice(0, 5)
            .map((node) => `    - ${node.target.join(' ')}: ${node.failureSummary}`)
            .join('\n')
      )
      .join('\n');
    throw new Error(`axe violations on ${context}:\n${summary}`);
  }
  expect(violations).toHaveLength(0);
}

/*
 * Known, REPORTED violations (renderer app code — see docs/beta-track-b-progress.md
 * item 7). Excluded so the audits gate NEW violations rather than restating
 * known debt on every run; remove each entry when its app-side fix lands.
 */

/** Dark-theme token contrast debt (text-muted, text-faint, accent, kbd colors). */
const CONTRAST_DEBT: AxeRuleExclusion = {
  rule: 'color-contrast',
  why: 'Dark-theme token debt: text-muted #727d8a on #161b22 (~4.1:1), kbd #727d8a on #30363d (~2.9:1), accent #6366f1 on dark (~3.9:1), text-faint #4d5866 (~2.1:1). Fixing means re-tuning the shared palette, not one component — reported to the renderer owners.',
};

/** App-chrome ARIA issues shared by every screen (TabBar). */
const CHROME_ARIA_DEBT: AxeRuleExclusion[] = [
  {
    rule: 'aria-required-children',
    why: 'TabBar puts the "new tab" button[aria-haspopup=menu] inside role="tablist" (layout/TabBar.tsx), whose allowed children are only role="tab". Reported.',
  },
  {
    rule: 'region',
    why: 'The same TabBar strip sits outside any landmark. Reported (moves inside <main> or gains role="navigation" with the tablist fix).',
  },
];

test.describe('Accessibility smoke', () => {
  test.beforeEach(async ({ electronApp, page }) => {
    await stabilize(electronApp, page);
  });

  test('key screens expose landmark roles', async ({ page }) => {
    // Home: application chrome (banner), primary content (main), the rail
    // (complementary, labelled) and the live status strip (status).
    await expect(page.getByRole('banner')).toBeVisible();
    await expect(page.getByRole('main')).toBeVisible();
    await expect(page.getByRole('complementary', { name: 'Sidebar' })).toBeVisible();
    await expect(page.getByRole('status', { name: 'Application status' })).toBeVisible();

    // The rail's navigation is a named landmark, not a bare div.
    await expect(
      page.getByRole('navigation', { name: 'Repositories and locations' })
    ).toBeVisible();

    // axe audit — home screen, full page.
    await expectNoAxeViolations(new AxeBuilder({ page }), 'home', [
      CONTRAST_DEBT,
      ...CHROME_ARIA_DEBT,
    ]);
  });

  test('files empty state passes an axe audit', async ({ page }) => {
    await page
      .getByTestId('sidebar-ready')
      .getByRole('link', { name: 'Files', exact: true })
      .click();
    await page.waitForURL(/\/files/, { timeout: 10000 });
    await expect(page.locator('main')).toBeVisible();
    await expect(page.locator('.skeleton-shimmer')).toHaveCount(0, { timeout: 10000 });

    await expectNoAxeViolations(new AxeBuilder({ page }), 'files empty state', [
      CONTRAST_DEBT,
      ...CHROME_ARIA_DEBT,
      {
        rule: 'page-has-heading-one',
        why: 'Best-practice rule: screens are landmark-based app chrome, not documents with h1s; heading hierarchy is an app-wide decision. Reported, excluded pending that decision.',
      },
    ]);
  });

  test('settings dialog is a labelled modal that contains focus', async ({ page }) => {
    await page.getByTestId('settings-button').click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 5000 });
    await expect(dialog).toHaveAttribute('aria-modal', 'true');

    // Focus must be inside the dialog, and its close control must expose an
    // accessible name.
    const focusInside = await dialog.evaluate(
      (node) => node.contains(document.activeElement)
    );
    expect(focusInside).toBe(true);
    await expect(page.getByTestId('modal-close-button')).toHaveAccessibleName(/.+/);

    // axe audit — scoped to the open modal (the page behind it is covered by
    // the home audit).
    await expectNoAxeViolations(
      new AxeBuilder({ page }).include('.modal-overlay'),
      'settings dialog',
      [CONTRAST_DEBT]
    );

    // Tab cycles within the dialog (focus containment, 6 hops).
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press('Tab');
      const stillInside = await page.evaluate(() => {
        const overlay = document.querySelector('.modal-overlay');
        return overlay ? overlay.contains(document.activeElement) : false;
      });
      expect(stillInside).toBe(true);
    }
  });

  test('keyboard focus shows a visible indicator on header controls', async ({ page }) => {
    // Walk the tab order until a header button is focused; the app styles
    // focus with a ring (box-shadow) or outline — either counts as visible.
    let found = false;
    for (let i = 0; i < 12 && !found; i++) {
      await page.keyboard.press('Tab');
      found = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el || !el.closest('header')) return false;
        const style = window.getComputedStyle(el);
        const outlineVisible =
          style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0;
        const ringVisible = style.boxShadow && style.boxShadow !== 'none';
        return outlineVisible || ringVisible;
      });
    }
    expect(found).toBe(true);
  });

  test('command palette search is a focused textbox', async ({ page }) => {
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+K' : 'Control+K');
    const palette = page.locator('.command-palette');
    await expect(palette).toBeVisible({ timeout: 5000 });

    const search = palette.getByRole('textbox');
    await expect(search).toBeFocused();
    await expect(search).toHaveAccessibleName(/.+/);

    // axe audit — scoped to the palette overlay.
    await expectNoAxeViolations(
      new AxeBuilder({ page }).include('.command-palette'),
      'command palette',
      [
        CONTRAST_DEBT,
        {
          rule: 'scrollable-region-focusable',
          why: '.command-palette-list is a scrollable div whose items are not focusable; keyboard users drive it via the search input (arrows + enter). Functional, but item focusability would improve SR support — reported.',
        },
      ]
    );

    // Escape closes the palette and restores focus to the page.
    await page.keyboard.press('Escape');
    await expect(palette).toBeHidden({ timeout: 5000 });
  });
});
