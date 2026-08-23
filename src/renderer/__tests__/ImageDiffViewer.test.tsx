import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ImageDiffViewer } from '../src/components/ui/ImageDiffViewer';
import { isImageFile } from '../src/components/ui/image-utils';

describe('ImageDiffViewer behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.api = {
      fs: {
        readFile: vi.fn().mockResolvedValue({
          success: true,
          content: 'iVBORw0KGgo=',
        }),
      },
      svn: {
        // The previous revision comes from the repository, not from a second
        // read of the working file (#48).
        cat: vi.fn().mockResolvedValue({
          target: 'C:\\wc\\image.png',
          revision: 'BASE',
          contentBase64: 'iVBORw0KGgoAAAANS',
          byteLength: 16,
          binary: true,
          truncated: false,
        }),
      },
    } as unknown as Window['api'];
  });

  it('recognizes common image asset formats and rejects non-image files', () => {
    for (const extension of [
      'png',
      'jpg',
      'jpeg',
      'gif',
      'bmp',
      'webp',
      'svg',
      'ico',
      'tiff',
      'tif',
    ]) {
      expect(isImageFile(`asset.${extension}`)).toBe(true);
      expect(isImageFile(`ASSET.${extension.toUpperCase()}`)).toBe(true);
    }

    expect(isImageFile('asset.psd')).toBe(false);
    expect(isImageFile('asset.txt')).toBe(false);
  });

  it('loads the working file once and the BASE revision via svn cat', async () => {
    // JSX attribute strings do not process escapes, so the path is shared as
    // a real JS string to keep the expectation honest.
    const path = 'C:\\wc\\image.png';
    render(<ImageDiffViewer isOpen={true} filePath={path} oldRevision="BASE" onClose={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByAltText('Original')).toBeInTheDocument();
      expect(screen.getByAltText('Modified')).toBeInTheDocument();
    });

    expect(window.api.fs.readFile).toHaveBeenCalledTimes(1);
    expect(window.api.svn.cat).toHaveBeenCalledWith(path, 'BASE');
    expect(screen.getByText('Image Diff: image.png')).toBeInTheDocument();
  });

  it('still shows the working copy when the base revision cannot be read', async () => {
    (window.api.svn.cat as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('not versioned')
    );

    render(
      <ImageDiffViewer isOpen={true} filePath="C:\\wc\\image.png" onClose={vi.fn()} />
    );

    await waitFor(() => {
      expect(screen.getByAltText('Modified')).toBeInTheDocument();
    });
    expect(screen.queryByAltText('Original')).not.toBeInTheDocument();
    expect(screen.getByText('1 version (new file)')).toBeInTheDocument();
  });
});
