#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';

const root = resolve(process.argv[2] || 'artifacts');
const output = resolve(root, 'SHA256SUMS');
const releaseExtension = /\.(?:dmg|zip|exe|AppImage|deb|rpm|tar\.gz)$/i;
const files = [];

function visit(directory) {
  for (const name of readdirSync(directory)) {
    const path = resolve(directory, name);
    if (statSync(path).isDirectory()) visit(path);
    else if (releaseExtension.test(name)) files.push(path);
  }
}

visit(root);
if (files.length === 0) throw new Error(`No release artifacts found below ${root}.`);
const lines = files
  .toSorted()
  .map(
    (path) => `${createHash('sha256').update(readFileSync(path)).digest('hex')}  ${basename(path)}`
  );
const names = lines.map((line) => line.slice(line.indexOf('  ') + 2));
if (new Set(names).size !== names.length) {
  throw new Error(
    'Release artifacts contain duplicate basenames; GitHub would flatten them ambiguously.'
  );
}
writeFileSync(output, `${lines.join('\n')}\n`, 'utf8');
console.log(`Wrote ${lines.length} artifact checksums to ${output}.`);
