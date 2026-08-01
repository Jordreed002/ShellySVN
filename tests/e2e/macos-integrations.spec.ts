import { test, expect } from '../helpers/electron-fixture';

/*
 * macOS integration journey. Runs only on a darwin host — CI's macos-14 E2E
 * runner and local macOS — so the platform never has to be forced. It verifies
 * the platform flows end-to-end through the built app: the main process runs on
 * darwin, the app:getPlatform IPC reaches the renderer as 'darwin', and a
 * browser window is created and shown. This complements the unit-level macOS
 * suites with a real launch against the packaged main process.
 */
test.describe('macOS integration', () => {
  test.skip(process.platform !== 'darwin', 'macOS-only integration checks');

  test('main process runs on darwin', async ({ electronApp }) => {
    const platform = await electronApp.evaluate(() => process.platform);
    expect(platform).toBe('darwin');
  });

  test('platform IPC reaches the renderer as darwin', async ({ page }) => {
    const platform = await page.evaluate(
      () =>
        (window as unknown as {
          api: { app: { getPlatform: () => Promise<string> } };
        }).api.app.getPlatform()
    );
    expect(platform).toBe('darwin');
  });

  test('creates a visible browser window with non-zero bounds', async ({ electronApp }) => {
    await electronApp.firstWindow(); // createWindow() runs in app.whenReady; wait for it

    // The window is created with show:false and shown on ready-to-show.
    await expect.poll(async () =>
      electronApp.evaluate(({ BrowserWindow }) => {
        const first = BrowserWindow.getAllWindows()[0];
        return first ? first.isVisible() : false;
      })
    ).toBe(true);

    const state = await electronApp.evaluate(({ BrowserWindow }) => {
      const windows = BrowserWindow.getAllWindows();
      const first = windows[0];
      return {
        count: windows.length,
        bounds: first ? first.getBounds() : null,
      };
    });
    expect(state.count).toBeGreaterThanOrEqual(1);
    expect(state.bounds?.width).toBeGreaterThan(0);
    expect(state.bounds?.height).toBeGreaterThan(0);
  });
});
