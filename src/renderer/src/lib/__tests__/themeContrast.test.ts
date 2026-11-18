import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

let stylesheet: string;
beforeAll(async () => {
  stylesheet = await readFile(resolve('src/renderer/src/styles/global.css'), 'utf8');
});

function palette(selector: string): Record<string, number[]> {
  const start = stylesheet.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`Missing theme ${selector}`);
  const block = stylesheet.slice(start, stylesheet.indexOf('}', start));
  return Object.fromEntries(
    [...block.matchAll(/--color-([\w-]+)-rgb: (\d+ \d+ \d+);/g)].map(([, name, rgb]) => [
      name,
      rgb.split(' ').map(Number),
    ])
  );
}

function luminance(rgb: number[]): number {
  const linear = rgb.map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
}

describe('readable workspace text', () => {
  for (const selector of [':root', ':root.dark', ':root.light']) {
    it(`${selector} keeps every text tier at AA contrast on opaque workspace surfaces`, () => {
      const colors = { ...palette(':root'), ...palette(selector) };
      for (const text of ['text', 'text-secondary', 'text-muted', 'text-faint']) {
        for (const surface of ['bg', 'bg-sunk', 'bg-secondary', 'bg-tertiary', 'bg-elevated']) {
          const [low, high] = [luminance(colors[text]), luminance(colors[surface])].sort(
            (a, b) => a - b
          );
          expect((high + 0.05) / (low + 0.05), `${text} on ${surface}`).toBeGreaterThanOrEqual(4.5);
        }
      }
    });
  }
});
