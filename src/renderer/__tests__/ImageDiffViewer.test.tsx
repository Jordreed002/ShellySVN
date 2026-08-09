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

  it('loads current and base image revisions for side-by-side comparison', async () => {
    render(
      <ImageDiffViewer
        isOpen={true}
        filePath="C:\\wc\\image.png"
        oldRevision="BASE"
        onClose={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByAltText('Original')).toBeInTheDocument();
      expect(screen.getByAltText('Modified')).toBeInTheDocument();
    });

    expect(window.api.fs.readFile).toHaveBeenCalledTimes(2);
    expect(screen.getByText('Image Diff: image.png')).toBeInTheDocument();
  });
});
