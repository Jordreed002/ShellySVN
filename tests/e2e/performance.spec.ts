import { test, expect } from '../helpers/electron-fixture';
import type { ElectronApplication, Page } from '@playwright/test';

const LARGE_LIST_COUNT = 20_000;
const LARGE_TREE_COUNT = 10_000;
const MIN_SCROLL_FPS = 10;

async function mockLargeDirectory(
  electronApp: ElectronApplication,
  directoryRootPath: string,
  fileCount: number
) {
  await electronApp.evaluate(
    ({ ipcMain }, payload) => {
      const files = Array.from({ length: payload.fileCount }, (_, index) => {
        const suffix = String(index).padStart(5, '0');
        const isDirectory = index % 10 === 0;
        return {
          name: `${isDirectory ? 'folder' : 'file'}-${suffix}${isDirectory ? '' : '.ts'}`,
          path: `${payload.directoryRootPath}\\${isDirectory ? 'folder' : 'file'}-${suffix}${isDirectory ? '' : '.ts'}`,
          isDirectory,
          size: isDirectory ? 0 : 1024 + index,
          modifiedTime: '2026-04-29T00:00:00.000Z',
        };
      });

      ipcMain.removeHandler('fs:listDirectory');
      ipcMain.handle('fs:listDirectory', (_event, path: string) =>
        Promise.resolve(path === payload.directoryRootPath ? files : [])
      );
      ipcMain.removeHandler('fs:isVersioned');
      ipcMain.handle('fs:isVersioned', () => Promise.resolve(false));
      ipcMain.removeHandler('fs:getParent');
      ipcMain.handle('fs:getParent', () => Promise.resolve(null));
      ipcMain.removeHandler('fs:getStatus');
      ipcMain.handle('fs:getStatus', () => Promise.resolve([]));
      ipcMain.removeHandler('fs:getDeepStatus');
      ipcMain.handle('fs:getDeepStatus', () => Promise.resolve([]));
      ipcMain.removeHandler('fs:getFolderSizes');
      ipcMain.handle('fs:getFolderSizes', () => Promise.resolve({}));
      ipcMain.removeHandler('dialog:openDirectory');
      ipcMain.handle('dialog:openDirectory', () => Promise.resolve(payload.directoryRootPath));
      ipcMain.removeHandler('svn:info');
      ipcMain.handle('svn:info', () =>
        Promise.resolve({
          url: 'https://example.test/svn/perf',
          repositoryRoot: 'https://example.test/svn',
          revision: '123',
        })
      );
    },
    { directoryRootPath, fileCount }
  );
}

async function mockLargeRepositoryTree(electronApp: ElectronApplication, treeEntryCount: number) {
  await electronApp.evaluate(
    ({ ipcMain }, payload) => {
      ipcMain.removeHandler('svn:list');
      ipcMain.handle('svn:list', (_event, url: string) => {
        const entries = Array.from({ length: payload.treeEntryCount }, (_, index) => {
          const suffix = String(index).padStart(5, '0');
          const isDirectory = index % 4 === 0;
          return {
            name: `${isDirectory ? 'dir' : 'file'}-${suffix}`,
            path: `${url.replace(/\/$/, '')}/${isDirectory ? 'dir' : 'file'}-${suffix}`,
            url: `${url.replace(/\/$/, '')}/${isDirectory ? 'dir' : 'file'}-${suffix}`,
            kind: isDirectory ? 'dir' : 'file',
            size: isDirectory ? undefined : 512 + index,
            revision: 123,
            author: 'perf',
            date: '2026-04-29T00:00:00.000Z',
          };
        });
        return Promise.resolve({ path: url, entries });
      });
    },
    { treeEntryCount }
  );
}

async function measureFileListScroll(page: Page) {
  return page.evaluate(async () => {
    const firstRow = document.querySelector<HTMLElement>('.file-row');
    const scroller = firstRow?.closest<HTMLElement>('.scrollbar-overlay');
    if (!scroller) {
      throw new Error('File list scroller not found');
    }

    const frameIntervals: number[] = [];
    let lastFrame = performance.now();
    const startedAt = lastFrame;

    await new Promise<void>((resolve) => {
      const step = (now: number) => {
        frameIntervals.push(now - lastFrame);
        lastFrame = now;
        const elapsed = now - startedAt;
        scroller.scrollTop = Math.min(
          scroller.scrollHeight - scroller.clientHeight,
          (elapsed / 600) * (scroller.scrollHeight - scroller.clientHeight)
        );

        if (elapsed < 600) {
          requestAnimationFrame(step);
        } else {
          resolve();
        }
      };
      requestAnimationFrame(step);
    });

    const averageFrameMs =
      frameIntervals.reduce((total, frameMs) => total + frameMs, 0) / frameIntervals.length;

    return {
      averageFps: 1000 / averageFrameMs,
      scrollTop: scroller.scrollTop,
    };
  });
}

test.describe('Performance smoke coverage', () => {
  test('renders and scrolls a large file list with bounded DOM rows', async ({
    electronApp,
    page,
  }) => {
    const rootPath = 'C:\\perf-large-list';
    await mockLargeDirectory(electronApp, rootPath, LARGE_LIST_COUNT);

    const startedAt = Date.now();
    if ((await page.getByTestId('browse-button').count()) > 0) {
      await page.getByTestId('browse-button').click();
    } else {
      await page.locator('aside button[title="Add Repository"]').click();
    }
    await page.locator('.modal button:has-text("Browse")').click();
    await page.getByRole('button', { name: 'Open', exact: true }).click();
    await expect(
      page.locator('.status-bar').filter({ hasText: `${LARGE_LIST_COUNT} items` })
    ).toBeVisible({
      timeout: 10_000,
    });
    const renderMs = Date.now() - startedAt;

    const rowCount = await page.locator('.file-row').count();
    const scroll = await measureFileListScroll(page);

    console.log(
      JSON.stringify({
        benchmark: 'large-file-list',
        items: LARGE_LIST_COUNT,
        renderMs,
        rowCount,
        averageFps: scroll.averageFps,
      })
    );

    expect(renderMs).toBeLessThan(process.env.CI ? 12_000 : 8_000);
    expect(rowCount).toBeGreaterThan(0);
    expect(rowCount).toBeLessThan(250);
    expect(scroll.scrollTop).toBeGreaterThan(0);
    expect(scroll.averageFps).toBeGreaterThan(MIN_SCROLL_FPS);
  });

  test('renders and scrolls a large sparse checkout tree with bounded DOM rows', async ({
    electronApp,
    page,
  }) => {
    await mockLargeRepositoryTree(electronApp, LARGE_TREE_COUNT);
    await page.locator('aside button[title="Add Repository"]').click();
    await page.waitForSelector('.modal-overlay', { state: 'visible', timeout: 5000 });
    await page.locator('.modal button:has-text("Checkout")').first().click();
    await page
      .locator('.modal input[placeholder*="svn"], .modal input[placeholder*="URL"]')
      .first()
      .fill('https://example.test/svn/perf');

    const startedAt = Date.now();
    await page.locator('button:has-text("Choose items")').click();
    const chooseItemsDialog = page.locator('.modal:has(h2.modal-title:has-text("Choose Items"))');
    await expect(chooseItemsDialog).toContainText('dir-00000', { timeout: 10_000 });
    const renderMs = Date.now() - startedAt;

    const visibleCheckboxes = await chooseItemsDialog.locator('input[type="checkbox"]').count();
    const scroll = await page.evaluate(async () => {
      const dialogElement = Array.from(document.querySelectorAll<HTMLElement>('.modal')).find(
        (modal) => modal.textContent?.includes('Choose Items')
      );
      const scroller = Array.from(dialogElement?.querySelectorAll<HTMLElement>('div') ?? []).find(
        (element) => {
          return (
            element.querySelector('input[type="checkbox"]') &&
            getComputedStyle(element).overflowY === 'auto'
          );
        }
      );
      if (!scroller) throw new Error('Tree scroller not found');

      const frameIntervals: number[] = [];
      let lastFrame = performance.now();
      const scrollStartedAt = lastFrame;

      await new Promise<void>((resolve) => {
        const step = (now: number) => {
          frameIntervals.push(now - lastFrame);
          lastFrame = now;
          const elapsed = now - scrollStartedAt;
          scroller.scrollTop = Math.min(
            scroller.scrollHeight - scroller.clientHeight,
            (elapsed / 600) * (scroller.scrollHeight - scroller.clientHeight)
          );

          if (elapsed < 600) {
            requestAnimationFrame(step);
          } else {
            resolve();
          }
        };
        requestAnimationFrame(step);
      });

      const averageFrameMs =
        frameIntervals.reduce((total, frameMs) => total + frameMs, 0) / frameIntervals.length;

      return {
        averageFps: 1000 / averageFrameMs,
        scrollTop: scroller.scrollTop,
      };
    });

    console.log(
      JSON.stringify({
        benchmark: 'large-sparse-tree',
        items: LARGE_TREE_COUNT,
        renderMs,
        visibleCheckboxes,
        averageFps: scroll.averageFps,
      })
    );

    expect(renderMs).toBeLessThan(process.env.CI ? 15_000 : 10_000);
    expect(visibleCheckboxes).toBeGreaterThan(0);
    expect(visibleCheckboxes).toBeLessThan(250);
    expect(scroll.scrollTop).toBeGreaterThan(0);
    expect(scroll.averageFps).toBeGreaterThan(MIN_SCROLL_FPS);
  });
});
