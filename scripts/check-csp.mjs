#!/usr/bin/env node
// Verifies that the renderer Content-Security-Policy in src/renderer/index.html
// stays strict: no 'unsafe-inline'/'unsafe-eval', no remote origins, no
// wildcards, and data:/blob: limited to img-src.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const htmlPath = process.argv[2]
  ? resolve(process.argv[2])
  : resolve(import.meta.dirname, '../src/renderer/index.html');
const html = readFileSync(htmlPath, 'utf8');

const FORBIDDEN_SOURCE_PATTERN = /^'(?:unsafe-inline|unsafe-eval|unsafe-hashes)'$/;
const SCHEME_SOURCE_PATTERN = /^[a-z][a-z0-9+.-]*:$/i;

const violations = [];

const metaMatches = [
  ...html.matchAll(/<meta[^>]+http-equiv="Content-Security-Policy"[^>]+content="([^"]+)"/gi),
];
if (metaMatches.length === 0) {
  violations.push('missing the Content-Security-Policy meta tag');
} else if (metaMatches.length > 1) {
  violations.push(`expected exactly one CSP meta tag, found ${metaMatches.length}`);
}

const directives = new Map();
for (const match of metaMatches) {
  for (const directive of match[1].split(';')) {
    const trimmed = directive.trim();
    if (!trimmed) continue;
    const [name, ...sources] = trimmed.split(/\s+/);
    if (directives.has(name)) violations.push(`duplicate directive ${name}`);
    directives.set(name, sources);
  }
}

for (const [name, sources] of directives) {
  for (const source of sources) {
    if (FORBIDDEN_SOURCE_PATTERN.test(source)) {
      violations.push(`${name} contains ${source}`);
    }
    if (source === '*') {
      violations.push(`${name} contains a wildcard source`);
    }
    if (source.includes('://')) {
      violations.push(`${name} allows remote origin ${source}`);
    }
    if (SCHEME_SOURCE_PATTERN.test(source)) {
      const isAllowedImageScheme = name === 'img-src' && (source === 'data:' || source === 'blob:');
      if (!isAllowedImageScheme) {
        violations.push(`${name} allows scheme source ${source} (only img-src data:/blob: may)`);
      }
    }
  }
}

const REQUIRED_DIRECTIVES = {
  'default-src': ["'self'"],
  'script-src': ["'self'"],
  'style-src': ["'self'"],
  'connect-src': ["'self'"],
  'font-src': ["'self'"],
  'worker-src': ["'self'"],
  'object-src': ["'none'"],
  'frame-src': ["'none'"],
  'base-uri': ["'none'"],
  'form-action': ["'none'"],
};

for (const [name, expectedSources] of Object.entries(REQUIRED_DIRECTIVES)) {
  const actualSources = directives.get(name);
  if (!actualSources) {
    violations.push(`missing required directive ${name}`);
  } else {
    for (const expected of expectedSources) {
      if (!actualSources.includes(expected)) {
        violations.push(`${name} must contain ${expected} (found [${actualSources.join(' ')}])`);
      }
    }
  }
}

if (violations.length > 0) {
  console.error(`Renderer CSP check failed for ${htmlPath}:`);
  console.error(violations.join('\n'));
  process.exit(1);
}

console.log('Renderer CSP check OK');
