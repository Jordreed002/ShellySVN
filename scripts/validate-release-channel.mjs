#!/usr/bin/env node
import { readFileSync } from 'node:fs';

const tag = (process.argv[2] || process.env.GITHUB_REF_NAME || '').replace(/^v/, '');
const version = JSON.parse(readFileSync('package.json', 'utf8')).version;
if (tag !== version)
  throw new Error(`Release channel check expected ${version}, received ${tag || '(empty)'}.`);

const prerelease = version.split('-', 2)[1];
const channel = prerelease ? 'preview' : 'stable';
if (prerelease && !/^(?:alpha|beta|rc)(?:\.|$)/.test(prerelease)) {
  throw new Error(
    `Unsupported public prerelease identifier "${prerelease}"; use alpha, beta, or rc for the preview channel.`
  );
}

console.log(`Release ${version} is valid for the ${channel} update channel.`);
