/**
 * Tests for Dialog IPC Handlers
 *
 * Tests native file/directory dialog operations.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// Create mock functions with hoisting
const mockShowOpenDialog = vi.hoisted(() => vi.fn());
const mockShowSaveDialog = vi.hoisted(() => vi.fn());
const mockShowMessageBox = vi.hoisted(() => vi.fn());
const mockIpcMainHandle = vi.hoisted(() => vi.fn());

// Mock electron module
vi.mock('electron', () => ({
  dialog: {
    showOpenDialog: mockShowOpenDialog,
    showSaveDialog: mockShowSaveDialog,
    showMessageBox: mockShowMessageBox,
  },
  ipcMain: {
    handle: mockIpcMainHandle,
  },
}));

// Import after mocking
import { registerDialogHandlers } from '../dialog';

describe('Dialog IPC Handlers', () => {
  // Store registered handlers
  const handlers: Map<string, (...args: unknown[]) => unknown> = new Map();

  beforeEach(() => {
    vi.clearAllMocks();
    handlers.clear();

    // Capture registered handlers
    mockIpcMainHandle.mockImplementation(
      (channel: string, handler: (...args: unknown[]) => unknown) => {
        handlers.set(channel, handler);
      }
    );

    // Register handlers
    registerDialogHandlers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('handler registration', () => {
    it('should register dialog:openDirectory handler', () => {
      expect(handlers.has('dialog:openDirectory')).toBe(true);
    });

    it('should register dialog:openFile handler', () => {
      expect(handlers.has('dialog:openFile')).toBe(true);
    });

    it('should register dialog:saveFile handler', () => {
      expect(handlers.has('dialog:saveFile')).toBe(true);
    });

    it('should register dialog:showMessage handler', () => {
      expect(handlers.has('dialog:showMessage')).toBe(true);
    });

    it('should register dialog:confirm handler', () => {
      expect(handlers.has('dialog:confirm')).toBe(true);
    });
  });

  describe('dialog:openDirectory', () => {
    it('should return selected directory path', async () => {
      mockShowOpenDialog.mockResolvedValue({
        canceled: false,
        filePaths: ['/Users/test/projects'],
      });

      const handler = handlers.get('dialog:openDirectory');
      const result = await handler!({}, '/Users/test/projects');

      expect(mockShowOpenDialog).toHaveBeenCalledWith({
        properties: ['openDirectory', 'createDirectory'],
        defaultPath: '/Users/test/projects',
      });
      expect(result).toBe('/Users/test/projects');
    });

    it('should return null when canceled', async () => {
      mockShowOpenDialog.mockResolvedValue({
        canceled: true,
        filePaths: [],
      });

      const handler = handlers.get('dialog:openDirectory');
      const result = await handler!({});

      expect(result).toBeNull();
    });

    it('should return null when no file selected', async () => {
      mockShowOpenDialog.mockResolvedValue({
        canceled: false,
        filePaths: [],
      });

      const handler = handlers.get('dialog:openDirectory');
      const result = await handler!({});

      expect(result).toBeNull();
    });

    it('should reject an invalid default directory path', async () => {
      const handler = handlers.get('dialog:openDirectory');

      await expect(handler!({}, 'bad\0path')).rejects.toThrow('Invalid default directory path');
      expect(mockShowOpenDialog).not.toHaveBeenCalled();
    });
  });

  describe('dialog:openFile', () => {
    it('should return selected file path', async () => {
      mockShowOpenDialog.mockResolvedValue({
        canceled: false,
        filePaths: ['/Users/test/document.txt'],
      });

      const handler = handlers.get('dialog:openFile');
      const result = await handler!({}, undefined);

      expect(mockShowOpenDialog).toHaveBeenCalledWith({
        properties: ['openFile'],
        filters: undefined,
      });
      expect(result).toBe('/Users/test/document.txt');
    });

    it('should pass filters to dialog', async () => {
      const filters = [{ name: 'Images', extensions: ['png', 'jpg'] }];
      mockShowOpenDialog.mockResolvedValue({
        canceled: false,
        filePaths: ['/Users/test/image.png'],
      });

      const handler = handlers.get('dialog:openFile');
      const result = await handler!({}, filters);

      expect(mockShowOpenDialog).toHaveBeenCalledWith({
        properties: ['openFile'],
        filters,
      });
      expect(result).toBe('/Users/test/image.png');
    });

    it('should return null when canceled', async () => {
      mockShowOpenDialog.mockResolvedValue({
        canceled: true,
        filePaths: [],
      });

      const handler = handlers.get('dialog:openFile');
      const result = await handler!({}, undefined);

      expect(result).toBeNull();
    });
  });

  describe('dialog:saveFile', () => {
    it('should return selected save path', async () => {
      mockShowSaveDialog.mockResolvedValue({
        canceled: false,
        filePath: '/Users/test/newfile.txt',
      });

      const handler = handlers.get('dialog:saveFile');
      const result = await handler!({}, undefined);

      expect(mockShowSaveDialog).toHaveBeenCalledWith({
        defaultPath: undefined,
      });
      expect(result).toBe('/Users/test/newfile.txt');
    });

    it('should use default name when provided', async () => {
      mockShowSaveDialog.mockResolvedValue({
        canceled: false,
        filePath: '/Users/test/mydocument.txt',
      });

      const handler = handlers.get('dialog:saveFile');
      const result = await handler!({}, 'mydocument.txt');

      expect(mockShowSaveDialog).toHaveBeenCalledWith({
        defaultPath: 'mydocument.txt',
      });
      expect(result).toBe('/Users/test/mydocument.txt');
    });

    it('should return null when canceled', async () => {
      mockShowSaveDialog.mockResolvedValue({
        canceled: true,
        filePath: undefined,
      });

      const handler = handlers.get('dialog:saveFile');
      const result = await handler!({}, undefined);

      expect(result).toBeNull();
    });

    it('should return null when no filePath returned', async () => {
      mockShowSaveDialog.mockResolvedValue({
        canceled: false,
        filePath: undefined,
      });

      const handler = handlers.get('dialog:saveFile');
      const result = await handler!({}, undefined);

      expect(result).toBeNull();
    });
  });

  describe('message dialogs', () => {
    it('should show a message box', async () => {
      mockShowMessageBox.mockResolvedValue({ response: 0 });

      const handler = handlers.get('dialog:showMessage');
      await handler!({}, { type: 'error', title: 'Failure', message: 'Something failed' });

      expect(mockShowMessageBox).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'error',
          title: 'Failure',
          message: 'Something failed',
          buttons: ['OK'],
        })
      );
    });

    it('should return true when confirm button is selected', async () => {
      mockShowMessageBox.mockResolvedValue({ response: 0 });

      const handler = handlers.get('dialog:confirm');
      const result = await handler!({}, { message: 'Proceed?', confirmLabel: 'Proceed' });

      expect(result).toBe(true);
      expect(mockShowMessageBox).toHaveBeenCalledWith(
        expect.objectContaining({
          buttons: ['Proceed', 'Cancel'],
          defaultId: 1,
          cancelId: 1,
        })
      );
    });

    it('should return false when cancel button is selected', async () => {
      mockShowMessageBox.mockResolvedValue({ response: 1 });

      const handler = handlers.get('dialog:confirm');
      const result = await handler!({}, { message: 'Proceed?' });

      expect(result).toBe(false);
    });
  });
});
