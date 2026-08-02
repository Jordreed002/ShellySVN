import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parse, stringify } from 'yaml';

const output = resolve(process.argv[2] || 'artifacts/update-metadata/latest-mac.yml');
const inputs = process.argv.slice(3).map(resolve);
if (inputs.length < 2) throw new Error('Expected x64 and arm64 latest-mac.yml inputs.');

const documents = inputs.map((path) => parse(readFileSync(path, 'utf8')));
const version = documents[0]?.version;
if (!version || documents.some((document) => document.version !== version)) {
  throw new Error('macOS update descriptors do not agree on a version.');
}

const files = new Map();
for (const document of documents) {
  for (const file of document.files || []) files.set(file.url, file);
}
for (const arch of ['x64', 'arm64']) {
  if (![...files.keys()].some((name) => name.includes(arch) && name.endsWith('.zip'))) {
    throw new Error(`macOS update metadata is missing the ${arch} ZIP.`);
  }
}

const preferred = [...files.values()].find(
  (file) => file.url.includes('x64') && file.url.endsWith('.zip')
);
const merged = {
  version,
  files: [...files.values()],
  path: preferred.url,
  sha512: preferred.sha512,
  releaseDate: documents
    .map((document) => document.releaseDate)
    .filter(Boolean)
    .toSorted()
    .at(-1),
};
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, stringify(merged), 'utf8');
console.log(`Merged ${files.size} macOS update files into ${output}`);
