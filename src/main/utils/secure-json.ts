import * as fs from 'fs';
import { dirname } from 'path';
import { randomBytes } from 'crypto';
import * as fsPromises from 'node:fs/promises';

function hardenDirectory(directory: string): void {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (process.platform !== 'win32' && typeof fs.chmodSync === 'function')
    fs.chmodSync(directory, 0o700);
}

export function hardenPrivateFile(filePath: string): void {
  if (process.platform !== 'win32' && fs.existsSync(filePath) && typeof fs.chmodSync === 'function')
    fs.chmodSync(filePath, 0o600);
}

export function writeSecureJsonSync(filePath: string, value: unknown): void {
  const directory = dirname(filePath);
  hardenDirectory(directory);
  const temporaryPath = `${filePath}.${randomBytes(8).toString('hex')}.tmp`;
  const descriptor = fs.openSync(temporaryPath, 'wx', 0o600);
  try {
    fs.writeFileSync(descriptor, JSON.stringify(value, null, 2), 'utf8');
  } finally {
    fs.closeSync(descriptor);
  }
  fs.renameSync(temporaryPath, filePath);
  hardenPrivateFile(filePath);
}

export async function writeSecureJson(filePath: string, value: unknown): Promise<void> {
  const directory = dirname(filePath);
  await fsPromises.mkdir(directory, { recursive: true, mode: 0o700 });
  if (process.platform !== 'win32' && typeof fsPromises.chmod === 'function')
    await fsPromises.chmod(directory, 0o700);
  const temporaryPath = `${filePath}.${randomBytes(8).toString('hex')}.tmp`;
  const handle = await fsPromises.open(temporaryPath, 'wx', 0o600);
  try {
    await handle.writeFile(JSON.stringify(value, null, 2), 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  await fsPromises.rename(temporaryPath, filePath);
  if (process.platform !== 'win32' && typeof fsPromises.chmod === 'function')
    await fsPromises.chmod(filePath, 0o600);
}
