import { readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, resolve } from 'node:path';

const tag = (process.argv[2] || process.env.GITHUB_REF_NAME || '').trim();
const artifactRoot = process.argv[3] ? resolve(process.argv[3]) : null;
const packageJson = JSON.parse(readFileSync(resolve('package.json'), 'utf8'));
const version = tag.replace(/^v/, '');
const semver =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:(?:0|[1-9]\d*)|(?:\d*[A-Za-z-][0-9A-Za-z-]*))(?:\.(?:(?:0|[1-9]\d*)|(?:\d*[A-Za-z-][0-9A-Za-z-]*)))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

if (!tag.startsWith('v') || !semver.test(version)) {
  throw new Error(`Release tag must be v-prefixed SemVer; received "${tag || '(empty)'}".`);
}
if (packageJson.version !== version) {
  throw new Error(`Release tag ${tag} does not match package.json version ${packageJson.version}.`);
}

if (artifactRoot) {
  const files = [];
  const visit = (directory) => {
    for (const name of readdirSync(directory)) {
      const path = resolve(directory, name);
      if (statSync(path).isDirectory()) visit(path);
      else files.push(path);
    }
  };
  visit(artifactRoot);
  const releaseFiles = files.filter((file) =>
    /\.(?:dmg|zip|exe|AppImage|deb|rpm|tar\.gz)$/i.test(file)
  );
  const mismatches = releaseFiles.filter((file) => !basename(file).includes(version));
  if (mismatches.length) {
    throw new Error(
      `Release artifacts missing version ${version}: ${mismatches.map((file) => basename(file)).join(', ')}`
    );
  }
}

console.log(`Release version verified: ${version}`);
