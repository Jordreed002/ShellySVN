/**
 * Serve the built renderer in a plain browser, with `window.api` stubbed.
 *
 * Two things make this necessary rather than convenient:
 *
 * 1. The renderer expects Electron's contextBridge, so without a stub every
 *    route dies on its first IPC call — see `stub-api.js`.
 * 2. TanStack Router uses history routing, so `/repo-browser` must serve
 *    `index.html`. A plain static server 404s and you see nothing.
 *
 * Usage:  bun run preview            # build first, then serve on :8940
 *         bun run preview -- --port 9000 --no-build
 */

import { createServer } from 'node:http';
import { spawnSync } from 'node:child_process';
import { readFile, writeFile, cp, rm, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../..');
const BUILT = path.join(REPO, 'out/renderer');
const STAGE = path.join(REPO, 'node_modules/.cache/shelly-preview');

const args = process.argv.slice(2);
const portArg = args.indexOf('--port');
const PORT = portArg === -1 ? 8940 : Number(args[portArg + 1]);
const shouldBuild = !args.includes('--no-build');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.map': 'application/json; charset=utf-8',
};

if (shouldBuild) {
  console.log('building renderer…');
  const result = spawnSync('bun', ['run', 'build'], { cwd: REPO, stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

if (!existsSync(BUILT)) {
  console.error(`no build at ${BUILT} — run \`bun run build\` first, or drop --no-build.`);
  process.exit(1);
}

await rm(STAGE, { recursive: true, force: true });
await mkdir(path.dirname(STAGE), { recursive: true });
await cp(BUILT, STAGE, { recursive: true });

const stub = await readFile(path.join(HERE, 'stub-api.js'), 'utf8');
const indexPath = path.join(STAGE, 'index.html');
const html = await readFile(indexPath, 'utf8');
if (!html.includes('<head>')) {
  console.error('index.html has no <head> to inject the stub into.');
  process.exit(1);
}
await writeFile(indexPath, html.replace('<head>', `<head>\n<script>${stub}</script>`));

createServer(async (request, response) => {
  const requested = decodeURIComponent((request.url ?? '/').split('?')[0].split('#')[0]);
  let file = path.join(STAGE, requested.replace(/^\/+/, ''));

  // SPA fallback: any path the build does not contain is a client-side route.
  if (!existsSync(file) || requested.endsWith('/')) file = indexPath;

  try {
    const body = await readFile(file);
    response.writeHead(200, {
      'content-type': MIME[path.extname(file)] ?? 'application/octet-stream',
      'cache-control': 'no-store',
    });
    response.end(body);
  } catch {
    response.writeHead(404).end('not found');
  }
}).listen(PORT, '127.0.0.1', () => {
  console.log(`\npreview  http://127.0.0.1:${PORT}/`);
  console.log(`browser  http://127.0.0.1:${PORT}/repo-browser?url=svn://demo/atlas`);
  console.log(`files    http://127.0.0.1:${PORT}/files?path=/Users/demo/wc/acme-website\n`);
});
