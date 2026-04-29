import { spawn } from 'child_process';

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
  process.exit(code ?? 1);
});

child.on('error', (error) => {
  console.error(error);
  process.exit(1);
});
