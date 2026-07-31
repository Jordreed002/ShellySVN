/**
 * Screenshot a preview route, optionally after driving the UI a little.
 *
 * The point is to compare against `prototypes/12-browser.html` — the design
 * source — rather than trusting that a component which compiles also renders.
 *
 * Usage:
 *   bun run preview:shot -- --out /tmp/browser.png \
 *     --path '/repo-browser?url=svn://demo/atlas' \
 *     --do 'row:clients|row:acme-corp|row:website|row:trunk|click:[role="tab"]:has-text("Blame")'
 *
 * Steps, separated by `|`:
 *   row:<text>      double-click the first listing row containing <text> (navigates)
 *   click:<sel>     click the first match for a CSS/Playwright selector
 *   rclick:<text>   right-click a row — opens the context menu
 *   text:<text>     click the first element containing <text>
 *   wait:<ms>       pause
 */

import { chromium } from '@playwright/test';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? fallback : args[index + 1];
};

const port = flag('port', '8940');
const route = flag('path', '/repo-browser?url=svn://demo/atlas');
const out = flag('out', 'preview.png');
const steps = flag('do', '');
const width = Number(flag('width', '1440'));
const height = Number(flag('height', '900'));
const dark = args.includes('--dark');

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width, height },
  colorScheme: dark ? 'dark' : 'light',
});

page.on('pageerror', (error) => console.log('PAGEERROR', error.message.split('\n')[0]));
page.on('console', (message) => {
  if (message.type() === 'error') console.log('CONSOLE', message.text().slice(0, 200));
});

await page.goto(`http://127.0.0.1:${port}${route}`, { waitUntil: 'load' });
await page.waitForTimeout(1400);

for (const step of steps.split('|').filter(Boolean)) {
  const separator = step.indexOf(':');
  const kind = step.slice(0, separator);
  const argument = step.slice(separator + 1);
  try {
    if (kind === 'row') await page.locator('[role="row"]', { hasText: argument }).first().dblclick();
    else if (kind === 'rclick') await page.locator('[role="row"]', { hasText: argument }).first().click({ button: 'right' });
    else if (kind === 'click') await page.locator(argument).first().click();
    else if (kind === 'text') await page.getByText(argument, { exact: false }).first().click();
    else if (kind === 'wait') await page.waitForTimeout(Number(argument));
    else console.log(`unknown step "${kind}"`);
  } catch (error) {
    console.log(`STEP FAILED ${step}: ${String(error).split('\n')[0]}`);
  }
  await page.waitForTimeout(600);
}

await page.waitForTimeout(700);
await page.screenshot({ path: out });
console.log(`wrote ${out}`);
await browser.close();
