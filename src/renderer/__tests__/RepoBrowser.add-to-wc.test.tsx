import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom';

const mockUpdateToRevision = vi.fn();

vi.mock('@tanstack/react-router', () => ({
  useSearch: () => ({ url: '' }),
  useNavigate: () => vi.fn(),
}));

vi.mock('@tanstack/react-query', () => ({
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

vi.mock('@renderer/components/ui/CheckoutDialog', () => ({
  CheckoutDialog: () => null,
}));

const mockWorkingCopyContext = {
  data: null as {
    repositoryRoot: string;
    workingCopyRoot: string;
    relativePath: string;
  } | null,
  isLoading: false,
};

vi.mock('@renderer/hooks/useWorkingCopyContext', () => ({
  useWorkingCopyContext: () => mockWorkingCopyContext,
}));

vi.mock('@renderer/utils/pathResolution', () => ({
  resolveRemoteUrlToLocalPath: vi.fn((remoteUrl: string, workingCopyRoot: string) => {
    if (remoteUrl.includes('repo/trunk')) {
      return workingCopyRoot + remoteUrl.split('repo')[1];
    }
    return null;
  }),
}));

vi.stubGlobal('window', {
  api: {
    svn: {
      list: vi.fn().mockResolvedValue({ entries: [] }),
      info: vi.fn(),
      updateToRevision: mockUpdateToRevision,
    },
    auth: {
      get: vi.fn().mockResolvedValue(null),
    },
    app: {
      openExternal: vi.fn(),
    },
  },
});

import { RepoBrowserContent } from '../src/routes/repo-browser/RepoBrowserContent';

describe('RepoBrowserContent Add to Working Copy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWorkingCopyContext.data = null;
    mockUpdateToRevision.mockReset();
  });

  describe('Add to Working Copy button visibility', () => {
    it('does not show Add to Working Copy when no working copy context', async () => {
      mockWorkingCopyContext.data = null;
      render(<RepoBrowserContent localPath="/some/path" />);

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
        relativePath: '',
      };
      render(<RepoBrowserContent localPath="/Users/test/project" />);

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
        relativePath: '',
      };
      render(<RepoBrowserContent localPath="/Users/test/project" />);

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
        relativePath: '',
      };
      mockUpdateToRevision.mockResolvedValueOnce({
        success: true,
        revision: 123,
      });

      render(<RepoBrowserContent localPath="/Users/test/project" />);

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
          '/Users/test/project/trunk/src',
          'infinity',
          true
        );
      });
    });

    it('shows loading state during operation', async () => {
      mockWorkingCopyContext.data = {
        repositoryRoot: 'https://svn.example.com/repo',
        workingCopyRoot: '/Users/test/project',
        relativePath: '',
      };
      mockUpdateToRevision.mockImplementation(
        () => new Promise((resolve) => setTimeout(resolve, 100))
      );

      render(<RepoBrowserContent localPath="/Users/test/project" />);

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
        relativePath: '',
      };
      mockUpdateToRevision.mockResolvedValueOnce({
        success: true,
        revision: 123,
      });

      render(<RepoBrowserContent localPath="/Users/test/project" />);

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
        relativePath: '',
      };
      mockUpdateToRevision.mockResolvedValueOnce({
        success: false,
        revision: 0,
        error: 'Network error',
      });

      render(<RepoBrowserContent localPath="/Users/test/project" />);

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
});
