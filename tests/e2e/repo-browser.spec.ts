import { test, expect } from '../helpers/electron-fixture';
import type { ElectronApplication, Page } from '@playwright/test';

async function openRepoBrowser(page: Page): Promise<void> {
  await page.getByRole('link', { name: 'Repository browser', exact: true }).click();
  await expect(page.getByRole('heading', { name: /repository browser/i })).toBeVisible();
}

async function installRepoBrowserMocks(electronApp: ElectronApplication): Promise<void> {
  await electronApp.evaluate(({ ipcMain }) => {
    const state = {
      mode: 'success',
      authAttempts: 0,
      calls: [] as Array<{
        url: string;
        revision?: string;
        depth?: string;
        authSessionId?: string;
      }>,
    };

    const makeEntries = (url: string) => ({
      entries: url.endsWith('/src')
        ? [
            {
              name: 'index.ts',
              path: '/index.ts',
              url: `${url}/index.ts`,
              kind: 'file' as const,
              size: 128,
              revision: 12,
              author: 'dev',
              date: '2026-04-30T10:00:00.000Z',
            },
          ]
        : [
            {
              name: 'src',
              path: '/src',
              url: `${url.replace(/\/$/, '')}/src`,
              kind: 'dir' as const,
              size: 0,
              revision: 12,
              author: 'dev',
              date: '2026-04-30T10:00:00.000Z',
            },
            {
              name: 'README.md',
              path: '/README.md',
              url: `${url.replace(/\/$/, '')}/README.md`,
              kind: 'file' as const,
              size: 256,
              revision: 11,
              author: 'dev',
              date: '2026-04-30T10:00:00.000Z',
            },
          ],
    });

    const testGlobal = globalThis as typeof globalThis & {
      __repoBrowserMockState: typeof state;
    };
    testGlobal.__repoBrowserMockState = state;

    ipcMain.removeHandler('auth:resumeSession');
    ipcMain.handle('auth:resumeSession', () => Promise.resolve(null));
    ipcMain.removeHandler('auth:beginSession');
    ipcMain.handle('auth:beginSession', (_event, request: { realm: string; username: string }) =>
      Promise.resolve({
        id: 'e2e-auth-session',
        realm: request.realm,
        username: request.username,
        persistent: false,
        expiresAt: null,
      })
    );
    ipcMain.removeHandler('svn:list');
    ipcMain.handle(
      'svn:list',
      (
        _event,
        url: string,
        revision?: string,
        depth?: 'empty' | 'immediates' | 'infinity',
        authSessionId?: string
      ) => {
        state.calls.push({ url, revision, depth, authSessionId });
        if (state.mode === 'auth-once' && state.authAttempts === 0) {
          state.authAttempts += 1;
          return Promise.resolve({
            path: url,
            entries: [],
            error: 'E215004: Authentication failed',
            errorCode: 'auth-required',
          });
        }
        if (state.mode === 'network-error') {
          return Promise.resolve({
            path: url,
            entries: [],
            error: 'Repository unavailable',
          });
        }
        return Promise.resolve({ path: url, ...makeEntries(url) });
      }
    );
    ipcMain.removeHandler('svn:proplist');
    ipcMain.handle('svn:proplist', () => Promise.resolve({ properties: [] }));
  });
}

async function setRepoBrowserMockMode(
  electronApp: ElectronApplication,
  mode: 'success' | 'auth-once' | 'network-error'
): Promise<void> {
  await electronApp.evaluate((_electron, nextMode) => {
    const state = (
      globalThis as typeof globalThis & {
        __repoBrowserMockState: { mode: string; authAttempts: number };
      }
    ).__repoBrowserMockState;
    state.mode = nextMode;
    if (nextMode === 'auth-once') state.authAttempts = 0;
  }, mode);
}

test.describe('Repository Browser', () => {
  test.beforeEach(async ({ electronApp, page }) => {
    await installRepoBrowserMocks(electronApp);
    await openRepoBrowser(page);
  });

  test('filters listings and navigates into a directory', async ({ electronApp, page }) => {
    await page.getByLabel('Repository URL').fill('https://svn.example.com/repo/trunk');
    await page.getByRole('button', { name: /connect/i }).click();

    await expect(page.getByText('src').first()).toBeVisible();
    await expect(page.getByText('README.md').first()).toBeVisible();

    const filter = page.getByRole('searchbox', { name: 'Filter this folder' });
    await filter.fill('readme');
    await expect(page.getByText('README.md').first()).toBeVisible();
    await expect(page.getByRole('grid').getByText('src', { exact: true }).first()).toBeHidden();

    await filter.fill('');
    await page.getByRole('row', { name: /Directory src/ }).dblclick();
    await expect(page.getByText('index.ts').first()).toBeVisible();

    await expect
      .poll(() =>
        electronApp.evaluate(() =>
          (
            globalThis as typeof globalThis & {
              __repoBrowserMockState: { calls: Array<{ url: string }> };
            }
          ).__repoBrowserMockState.calls.some((call) => call.url.endsWith('/src'))
        )
      )
      .toBe(true);
  });

  test('recovers through auth prompts and connection errors', async ({ electronApp, page }) => {
    await setRepoBrowserMockMode(electronApp, 'auth-once');

    await page.getByLabel('Repository URL').fill('https://svn.example.com/repo/trunk');
    await page.getByRole('button', { name: /connect/i }).click();

    await expect(page.getByText(/Authentication required/i)).toBeVisible();
    await page.getByLabel('Username').fill('alice');
    await page.getByLabel('Password').fill('secret');
    await page.getByRole('button', { name: /authenticate/i }).click();
    await expect(page.getByText('README.md').first()).toBeVisible();

    await setRepoBrowserMockMode(electronApp, 'network-error');
    await page.getByRole('link', { name: 'Home', exact: true }).click();
    await openRepoBrowser(page);
    await page.getByLabel('Repository URL').fill('https://svn.example.com/repo/trunk');
    await page.getByRole('button', { name: /connect/i }).click();
    await expect(page.getByText(/Connection failed/i)).toBeVisible();
    await expect(page.getByText('Repository unavailable')).toBeVisible();

    await setRepoBrowserMockMode(electronApp, 'success');
    await page.getByRole('button', { name: /connect/i }).click();
    await expect(page.getByText('README.md').first()).toBeVisible();
  });
});
