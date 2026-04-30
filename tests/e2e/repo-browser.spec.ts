import { test, expect } from '../helpers/electron-fixture';

async function openRepoBrowser(page: import('@playwright/test').Page): Promise<void> {
  await page.click('a:has-text("Repo Browser")');
  await expect(page.getByText('Repository Browser').first()).toBeVisible();
}

async function installRepoBrowserMocks(page: import('@playwright/test').Page): Promise<void> {
  await page.evaluate(() => {
    const state = {
      mode: 'success',
      authAttempts: 0,
      calls: [] as Array<{
        url: string;
        revision?: string;
        depth?: string;
        credentials?: { username: string; password: string };
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

    (
      window as typeof window & {
        __repoBrowserE2e: {
          auth: { get: () => Promise<null> };
          svnList: (
            url: string,
            revision?: string,
            depth?: 'empty' | 'immediates' | 'infinity',
            credentials?: { username: string; password: string }
          ) => Promise<ReturnType<typeof makeEntries>>;
        };
      }
    ).__repoBrowserE2e = {
      auth: {
        get: async () => null,
      },
      svnList: async (url, revision, depth, credentials) => {
        state.calls.push({ url, revision, depth, credentials });
        if (state.mode === 'auth-once' && state.authAttempts === 0) {
          state.authAttempts += 1;
          throw new Error('E215004: Authentication failed');
        }
        if (state.mode === 'network-error') {
          throw new Error('Repository unavailable');
        }
        return makeEntries(url);
      },
    };

    (window as typeof window & { __repoBrowserMockState: typeof state }).__repoBrowserMockState =
      state;
  });
}

test.describe('Repository Browser', () => {
  test.beforeEach(async ({ page }) => {
    await installRepoBrowserMocks(page);
    await openRepoBrowser(page);
  });

  test('filters listings and prefetches directory navigation', async ({ page }) => {
    await page.getByPlaceholder(/repository URL/i).fill('https://svn.example.com/repo/trunk');
    await page.getByRole('button', { name: /connect/i }).click();

    await expect(page.getByText('src').first()).toBeVisible();
    await expect(page.getByText('README.md').first()).toBeVisible();

    await page.getByPlaceholder('Filter...').fill('readme');
    await expect(page.getByText('README.md').first()).toBeVisible();
    await expect(page.getByText('src').first()).toBeHidden();

    await page.getByPlaceholder('Filter...').fill('');
    await page.getByText('src').first().hover();

    await expect
      .poll(() =>
        page.evaluate(() =>
          (
            window as typeof window & {
              __repoBrowserMockState: { calls: Array<{ url: string }> };
            }
          ).__repoBrowserMockState.calls.some((call) => call.url.endsWith('/src'))
        )
      )
      .toBe(true);
  });

  test('recovers through auth prompts and connection errors', async ({ page }) => {
    await page.evaluate(() => {
      (
        window as typeof window & { __repoBrowserMockState: { mode: string; authAttempts: number } }
      ).__repoBrowserMockState.mode = 'auth-once';
    });

    await page.getByPlaceholder(/repository URL/i).fill('https://svn.example.com/repo/trunk');
    await page.getByRole('button', { name: /connect/i }).click();

    await expect(page.getByText('Authentication Required')).toBeVisible();
    await page.getByLabel('Username').fill('alice');
    await page.getByLabel('Password').fill('secret');
    await page.getByRole('button', { name: /authenticate/i }).click();
    await expect(page.getByText('README.md').first()).toBeVisible();

    await page.evaluate(() => {
      (
        window as typeof window & { __repoBrowserMockState: { mode: string } }
      ).__repoBrowserMockState.mode = 'network-error';
    });
    await page.getByRole('button', { name: /connect/i }).click();
    await expect(page.getByText('Connection Failed')).toBeVisible();
    await expect(page.getByText('Repository unavailable')).toBeVisible();

    await page.evaluate(() => {
      (
        window as typeof window & { __repoBrowserMockState: { mode: string } }
      ).__repoBrowserMockState.mode = 'success';
    });
    await page.getByRole('button', { name: /connect/i }).click();
    await expect(page.getByText('README.md').first()).toBeVisible();
  });
});
