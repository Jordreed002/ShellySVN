import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom';

const mockUpdateToRevision = vi.fn();
const mockCat = vi.fn();

vi.mock('@tanstack/react-router', () => ({
  useSearch: () => ({ url: '' }),
  useNavigate: () => vi.fn(),
}));

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  useQuery: vi.fn(() => ({
    data: {
      entries: [
        {
          name: 'src',
          path: '/src',
          url: 'https://svn.example.com/repo/trunk/src',
          kind: 'dir',
          size: 0,
          revision: 123,
          author: 'dev',
          date: '2024-01-01T00:00:00Z',
        },
        {
          name: 'README.md',
          path: '/README.md',
          url: 'https://svn.example.com/repo/trunk/README.md',
          kind: 'file',
          size: 100,
          revision: 122,
          author: 'dev',
          date: '2024-01-01T00:00:00Z',
        },
      ],
    },
    isLoading: false,
    refetch: vi.fn(),
  })),
}));

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getVirtualItems: () =>
      Array.from({ length: count }, (_, index) => ({
        index,
        key: index,
        start: index * 37,
        size: 37,
      })),
    getTotalSize: () => count * 37,
    measureElement: vi.fn(),
    scrollToIndex: vi.fn(),
  }),
}));

vi.mock('@renderer/components/ui/CheckoutDialog', () => ({
  CheckoutDialog: () => null,
}));

const mockWorkingCopyContext = {
  data: null as {
    repositoryRoot: string;
    workingCopyRoot: string;
    workingCopyUrl: string;
    relativePath: string;
  } | null,
  isLoading: false,
};

vi.mock('@renderer/hooks/useWorkingCopyContext', () => ({
  useWorkingCopyContext: () => mockWorkingCopyContext,
}));

vi.mock('@renderer/utils/pathResolution', () => ({
  resolveRemoteUrlToLocalPath: vi.fn(
    (remoteUrl: string, workingCopyRoot: string, _repositoryRoot: string, workingCopyUrl: string) => {
      if (remoteUrl === workingCopyUrl || remoteUrl.startsWith(`${workingCopyUrl}/`)) {
        return workingCopyRoot + remoteUrl.slice(workingCopyUrl.length);
      }
      return null;
    }
  ),
}));

Object.defineProperty(window, 'api', {
  configurable: true,
  value: {
    svn: {
      list: vi.fn().mockResolvedValue({ entries: [] }),
      info: vi.fn(),
      updateToRevision: mockUpdateToRevision,
      cat: mockCat,
    },
    auth: {
      get: vi.fn().mockResolvedValue(null),
    },
    app: {
      openExternal: vi.fn(),
    },
  },
});

import { RepoBrowserContent } from '../src/routes/repo-browser/-RepoBrowserContent';

async function renderConnected(localPath: string) {
  render(<RepoBrowserContent localPath={localPath} />);
  fireEvent.change(screen.getByPlaceholderText(/Enter repository URL/i), {
    target: { value: 'https://svn.example.com/repo/trunk' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
  await screen.findByText('src');
}

describe('RepoBrowserContent Add to Working Copy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWorkingCopyContext.data = null;
    mockUpdateToRevision.mockReset();
    mockCat.mockReset();
  });

  describe('Add to Working Copy button visibility', () => {
    it('does not show Add to Working Copy when no working copy context', async () => {
      mockWorkingCopyContext.data = null;
      await renderConnected('/some/path');

      const srcRow = await screen.findByText('src');
      fireEvent.click(srcRow);

      expect(
        screen.queryByRole('button', { name: /add to working copy/i })
      ).not.toBeInTheDocument();
    });

    it('does not show Add to Working Copy for files', async () => {
      mockWorkingCopyContext.data = {
        repositoryRoot: 'https://svn.example.com/repo',
        workingCopyRoot: '/Users/test/project',
        workingCopyUrl: 'https://svn.example.com/repo/trunk',
        relativePath: '',
      };
      await renderConnected('/Users/test/project');

      const fileRow = await screen.findByText('README.md');
      fireEvent.click(fileRow);

      expect(
        screen.queryByRole('button', { name: /add to working copy/i })
      ).not.toBeInTheDocument();
    });

    it('shows Add to Working Copy for directories when working copy context exists', async () => {
      mockWorkingCopyContext.data = {
        repositoryRoot: 'https://svn.example.com/repo',
        workingCopyRoot: '/Users/test/project',
        workingCopyUrl: 'https://svn.example.com/repo/trunk',
        relativePath: '',
      };
      await renderConnected('/Users/test/project');

      const srcRow = await screen.findByText('src');
      fireEvent.click(srcRow);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /add to working copy/i })).toBeInTheDocument();
      });
    });
  });

  describe('Add to Working Copy functionality', () => {
    it('calls updateToRevision when button is clicked', async () => {
      mockWorkingCopyContext.data = {
        repositoryRoot: 'https://svn.example.com/repo',
        workingCopyRoot: '/Users/test/project',
        workingCopyUrl: 'https://svn.example.com/repo/trunk',
        relativePath: '',
      };
      mockUpdateToRevision.mockResolvedValueOnce({
        success: true,
        revision: 123,
      });

      await renderConnected('/Users/test/project');

      const srcRow = await screen.findByText('src');
      fireEvent.click(srcRow);

      const addButton = await screen.findByRole('button', {
        name: /add to working copy/i,
      });
      fireEvent.click(addButton);

      await waitFor(() => {
        expect(mockUpdateToRevision).toHaveBeenCalledWith(
          '/Users/test/project',
          'https://svn.example.com/repo/trunk/src',
          '/Users/test/project/src',
          'infinity',
          true
        );
      });
    });

    it('shows loading state during operation', async () => {
      mockWorkingCopyContext.data = {
        repositoryRoot: 'https://svn.example.com/repo',
        workingCopyRoot: '/Users/test/project',
        workingCopyUrl: 'https://svn.example.com/repo/trunk',
        relativePath: '',
      };
      mockUpdateToRevision.mockImplementation(
        () => new Promise((resolve) => setTimeout(resolve, 100))
      );

      await renderConnected('/Users/test/project');

      const srcRow = await screen.findByText('src');
      fireEvent.click(srcRow);

      const addButton = await screen.findByRole('button', {
        name: /add to working copy/i,
      });
      fireEvent.click(addButton);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /adding\.\.\./i })).toBeInTheDocument();
      });
    });

    it('shows success message after successful operation', async () => {
      mockWorkingCopyContext.data = {
        repositoryRoot: 'https://svn.example.com/repo',
        workingCopyRoot: '/Users/test/project',
        workingCopyUrl: 'https://svn.example.com/repo/trunk',
        relativePath: '',
      };
      mockUpdateToRevision.mockResolvedValueOnce({
        success: true,
        revision: 123,
      });

      await renderConnected('/Users/test/project');

      const srcRow = await screen.findByText('src');
      fireEvent.click(srcRow);

      const addButton = await screen.findByRole('button', {
        name: /add to working copy/i,
      });
      fireEvent.click(addButton);

      await waitFor(() => {
        expect(screen.getByText(/added to working copy/i)).toBeInTheDocument();
      });
    });

    it('shows error message when operation fails', async () => {
      mockWorkingCopyContext.data = {
        repositoryRoot: 'https://svn.example.com/repo',
        workingCopyRoot: '/Users/test/project',
        workingCopyUrl: 'https://svn.example.com/repo/trunk',
        relativePath: '',
      };
      mockUpdateToRevision.mockResolvedValueOnce({
        success: false,
        revision: 0,
        error: 'Network error',
      });

      await renderConnected('/Users/test/project');

      const srcRow = await screen.findByText('src');
      fireEvent.click(srcRow);

      const addButton = await screen.findByRole('button', {
        name: /add to working copy/i,
      });
      fireEvent.click(addButton);

      await waitFor(() => {
        expect(screen.getByText(/network error/i)).toBeInTheDocument();
      });
    });
  });

  it('retrieves and previews a repository file at its listed revision', async () => {
    mockCat.mockResolvedValue({
      target: 'https://svn.example.com/repo/trunk/README.md',
      revision: '122',
      contentBase64: btoa('repository readme'),
      byteLength: 17,
      binary: false,
      truncated: false,
    });
    await renderConnected('/Users/test/project');
    fireEvent.click(await screen.findByText('README.md'));
    fireEvent.click(await screen.findByRole('button', { name: /view file/i }));

    await waitFor(() => {
      expect(mockCat).toHaveBeenCalledWith(
        'https://svn.example.com/repo/trunk/README.md',
        '122',
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      );
    });
    expect(await screen.findByText('repository readme')).toBeInTheDocument();
  });
});
