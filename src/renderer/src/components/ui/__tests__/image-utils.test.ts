import { describe, expect, it } from 'vitest';

import { isImageFile } from '../image-utils';

/**
 * J7 — Diff/blame. The image diff viewer is chosen for binary image assets via
 * this single predicate, so a regression either shows a broken code diff for an
 * image or tries to render a text file as pixels.
 */
describe('isImageFile', () => {
  it.each([
    ['logo.png', true],
    ['photo.JPG', true], // uppercase extension is normalized
    ['photo.jpeg', true],
    ['anim.gif', true],
    ['bitmap.bmp', true],
    ['shot.webp', true],
    ['icon.svg', true],
    ['fav.ico', true],
    ['scan.tiff', true],
    ['scan.tif', true],
    ['readme.md', false],
    ['app.tsx', false],
    ['archive.zip', false],
    ['noextension', false],
  ])('classifies %s as %s', (path, expected) => {
    expect(isImageFile(path)).toBe(expected);
  });

  it('handles dotted paths by looking only at the final extension', () => {
    expect(isImageFile('assets/screenshots/home.final.png')).toBe(true);
    expect(isImageFile('src/components/ui/image-utils.ts')).toBe(false);
  });
});
