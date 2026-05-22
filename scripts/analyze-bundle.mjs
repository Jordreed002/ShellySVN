import { spawn } from 'child_process';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const KIB = 1024;
const DEFAULT_RAW_LIMIT_BYTES = 750 * KIB;
const DEFAULT_GZIP_LIMIT_BYTES = 160 * KIB;
const REPORT_PATH = resolve(process.cwd(), 'reports/bundle/renderer-bundle-report.json');

function formatBytes(bytes) {
  if (bytes < KIB) return `${bytes} B`;
  if (bytes < KIB * KIB) return `${(bytes / KIB).toFixed(1)} KiB`;
  return `${(bytes / KIB / KIB).toFixed(2)} MiB`;
}

function readBudgetBytes(envName, defaultBytes) {
  const rawValue = process.env[envName];
  if (!rawValue) return defaultBytes;

  const value = Number(rawValue);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${envName} must be a positive number of KiB.`);
  }

  return value * KIB;
}

function getInitialChunks(chunks) {
  const chunkByFileName = new Map(chunks.map((chunk) => [chunk.fileName, chunk]));
  const initialChunkNames = new Set();

  const visit = (fileName) => {
    if (initialChunkNames.has(fileName)) return;
    const chunk = chunkByFileName.get(fileName);
    if (!chunk) return;

    initialChunkNames.add(fileName);
    for (const importFileName of chunk.imports || []) {
      visit(importFileName);
    }
  };

  for (const chunk of chunks) {
    if (chunk.isEntry) {
      visit(chunk.fileName);
    }
  }

  return chunks.filter((chunk) => initialChunkNames.has(chunk.fileName));
}

function checkBundleBudget() {
  const report = JSON.parse(readFileSync(REPORT_PATH, 'utf8'));
  const chunks = report.rendererChunks;
  if (!Array.isArray(chunks) || chunks.length === 0) {
    throw new Error(`Bundle report has no renderer chunks: ${REPORT_PATH}`);
  }

  const initialChunks = getInitialChunks(chunks);
  const rawBytes = initialChunks.reduce((total, chunk) => total + chunk.bytes, 0);
  const gzipBytes = initialChunks.reduce((total, chunk) => total + chunk.gzipBytes, 0);
  const rawLimitBytes = readBudgetBytes('SHELLYSVN_BUNDLE_INITIAL_RAW_KIB', DEFAULT_RAW_LIMIT_BYTES);
  const gzipLimitBytes = readBudgetBytes(
    'SHELLYSVN_BUNDLE_INITIAL_GZIP_KIB',
    DEFAULT_GZIP_LIMIT_BYTES
  );

  console.log('\nRenderer initial bundle budget');
  console.log(`  Chunks: ${initialChunks.map((chunk) => chunk.fileName).join(', ')}`);
  console.log(`  Raw: ${formatBytes(rawBytes)} / ${formatBytes(rawLimitBytes)}`);
  console.log(`  Gzip: ${formatBytes(gzipBytes)} / ${formatBytes(gzipLimitBytes)}`);

  const failures = [];
  if (rawBytes > rawLimitBytes) {
    failures.push(`raw ${formatBytes(rawBytes)} exceeds ${formatBytes(rawLimitBytes)}`);
  }
  if (gzipBytes > gzipLimitBytes) {
    failures.push(`gzip ${formatBytes(gzipBytes)} exceeds ${formatBytes(gzipLimitBytes)}`);
  }

  if (failures.length > 0) {
    throw new Error(`Renderer initial bundle budget failed: ${failures.join('; ')}`);
  }
}

if (process.argv.includes('--check-only')) {
  try {
    checkBundleBudget();
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
  process.exit(0);
}

const isWindows = process.platform === 'win32';
const command = isWindows ? 'cmd.exe' : 'bun';
const args = isWindows ? ['/d', '/s', '/c', 'bun run build'] : ['run', 'build'];

const child = spawn(command, args, {
  cwd: process.cwd(),
  env: {
    ...process.env,
    SHELLYSVN_BUNDLE_REPORT: '1',
  },
  stdio: 'inherit',
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  if (code !== 0) {
    process.exit(code ?? 1);
    return;
  }

  try {
    checkBundleBudget();
  } catch (error) {
    console.error(error);
    process.exit(1);
  }

  process.exit(0);
});

child.on('error', (error) => {
  console.error(error);
  process.exit(1);
});
