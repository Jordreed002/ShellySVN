import { spawn } from 'child_process';

const files = [
  'src/renderer/__tests__/performance/working-copy-status.perf.test.ts',
  'src/renderer/__tests__/performance/log-history.perf.test.ts',
  'src/renderer/__tests__/performance/repo-browser-lazy-loading.perf.test.tsx',
  'src/renderer/__tests__/performance/sparse-checkout.perf.test.tsx',
  'src/renderer/src/features/files/__tests__/fileStatus.test.ts',
  'src/renderer/src/features/files/__tests__/fileListTransforms.test.ts',
  'src/renderer/__tests__/useCommitDialogController.test.tsx',
];

const isWindows = process.platform === 'win32';
const command = isWindows ? 'cmd.exe' : 'bun';
const args = isWindows
  ? ['/d', '/s', '/c', `bun x vitest run ${files.join(' ')}`]
  : ['x', 'vitest', 'run', ...files];

const child = spawn(command, args, {
  cwd: process.cwd(),
  env: {
    ...process.env,
    SHELLYSVN_STRICT_PERF: '1',
  },
  stdio: 'inherit',
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});

child.on('error', (error) => {
  console.error(error);
  process.exit(1);
});
