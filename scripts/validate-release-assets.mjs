import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { parse } from 'yaml';

const root = resolve(process.argv[2] || 'artifacts');
const version = JSON.parse(readFileSync(resolve('package.json'), 'utf8')).version;
const includeLinux = process.env.SKIP_LINUX !== 'true';
const files = [];
const visit = (directory) => {
  for (const name of readdirSync(directory)) {
    const path = resolve(directory, name);
    if (statSync(path).isDirectory()) visit(path);
    else files.push(path);
  }
};
visit(root);

const requireOne = (label, pattern) => {
  const matches = files.filter((file) => pattern.test(basename(file)));
  if (matches.length !== 1)
    throw new Error(`${label}: expected one asset, found ${matches.length}.`);
  return matches[0];
};

requireOne('Windows installer', new RegExp(`ShellySVN-${version}-x64-setup\\.exe$`, 'i'));
requireOne('Windows metadata', /^latest\.yml$/i);
requireOne('Windows blockmap', /setup\.exe\.blockmap$/i);
for (const arch of ['x64', 'arm64']) {
  requireOne(`macOS ${arch} DMG`, new RegExp(`ShellySVN-${version}-${arch}\\.dmg$`, 'i'));
  requireOne(`macOS ${arch} ZIP`, new RegExp(`ShellySVN-${version}-${arch}\\.zip$`, 'i'));
}
const macMetadata = resolve(root, 'update-metadata/latest-mac.yml');
if (!files.includes(macMetadata)) throw new Error('Merged macOS metadata is missing.');
if (includeLinux) {
  requireOne('Linux AppImage', new RegExp(`ShellySVN-${version}-x64\\.AppImage$`, 'i'));
  requireOne('Linux metadata', /^latest-linux\.yml$/i);
  requireOne('Linux Debian package', new RegExp(`ShellySVN-${version}-x64\\.deb$`, 'i'));
  requireOne('Linux RPM package', new RegExp(`ShellySVN-${version}-x64\\.rpm$`, 'i'));
  requireOne('Linux tarball', new RegExp(`ShellySVN-${version}-x64\\.tar\\.gz$`, 'i'));
}

for (const metadataPath of files.filter((file) => /latest(?:-mac|-linux)?\.yml$/i.test(file))) {
  const metadata = parse(readFileSync(metadataPath, 'utf8'));
  if (metadata.version !== version) {
    throw new Error(`${basename(metadataPath)} declares ${metadata.version}; expected ${version}.`);
  }
  const descriptors =
    metadata.files?.length > 0 ? metadata.files : [{ url: metadata.path, sha512: metadata.sha512 }];
  for (const descriptor of descriptors) {
    if (!descriptor.url || !descriptor.sha512) {
      throw new Error(`${basename(metadataPath)} contains an incomplete artifact descriptor.`);
    }
    const artifact = files.find((file) => basename(file) === basename(descriptor.url));
    if (!artifact) {
      throw new Error(`${basename(metadataPath)} references missing asset ${descriptor.url}.`);
    }
    const sha512 = createHash('sha512').update(readFileSync(artifact)).digest('base64');
    if (sha512 !== descriptor.sha512) {
      throw new Error(`SHA-512 mismatch for ${descriptor.url} in ${basename(metadataPath)}.`);
    }
  }
}

const mac = parse(readFileSync(macMetadata, 'utf8'));
for (const arch of ['x64', 'arm64']) {
  const descriptor = mac.files?.find(
    (file) => file.url.includes(arch) && file.url.endsWith('.zip')
  );
  if (!descriptor) throw new Error(`Merged macOS metadata has no ${arch} ZIP.`);
  const artifact = files.find((file) => basename(file) === basename(descriptor.url));
  if (!artifact) throw new Error(`Metadata references missing asset ${descriptor.url}.`);
}

console.log(`Validated updater assets for ShellySVN ${version}.`);
