import { spawn } from 'node:child_process';
import type { AiModelInfo } from '@shared/types';
import { terminateProcessTree } from '../utils/process-tree';

/** Metadata-only handshakes. No prompt or inference request is sent. */
export function discoverCliModels(
  provider: 'codex' | 'claude',
  executable: { command: string; prefixArgs: string[] },
  env: NodeJS.ProcessEnv
): Promise<AiModelInfo[]> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      executable.command,
      [
        ...executable.prefixArgs,
        ...(provider === 'codex'
          ? ['app-server']
          : [
              '--print',
              '--input-format',
              'stream-json',
              '--output-format',
              'stream-json',
              '--verbose',
            ]),
      ],
      {
        env,
        windowsHide: true,
        detached: process.platform !== 'win32',
        stdio: ['pipe', 'pipe', 'pipe'],
      }
    );
    let buffer = '';
    let bytes = 0;
    let settled = false;
    const timer = setTimeout(() => finish(new Error('Model discovery timed out')), 15_000);
    const finish = (error?: Error, models?: AiModelInfo[]) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.stdin.destroy();
      void terminateProcessTree(child, 0).catch(() => undefined);
      if (error) reject(error);
      else resolve(models!);
    };
    const send = (message: unknown) => child.stdin.write(JSON.stringify(message) + '\n');
    child.stdin.on('error', () => finish(new Error('Model discovery input closed')));
    child.on('error', (error) => finish(error));
    child.on('close', () => finish(new Error('Model discovery exited before replying')));
    child.stderr.on('data', () => {
      /* Drain diagnostics without retaining sensitive output. */
    });
    const models: AiModelInfo[] = [];
    const cursors = new Set<string>();
    child.stdout.on('data', (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > 2_000_000) return finish(new Error('Model catalog exceeded size limit'));
      buffer += chunk.toString('utf8');
      let newline: number;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        if (settled) return;
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        try {
          const message = JSON.parse(line);
          if (provider === 'codex' && message.id === 1) {
            if (message.error) return finish(new Error('Codex initialization failed'));
            send({ method: 'initialized' });
            send({ id: 2, method: 'model/list', params: { includeHidden: false } });
          } else if (
            (provider === 'codex' && message.id === 2) ||
            (provider === 'claude' &&
              message.type === 'control_response' &&
              message.response?.request_id === 'models')
          ) {
            const result = provider === 'codex' ? message.result : message.response?.response;
            const rows = provider === 'codex' ? result?.data : result?.models;
            if (!Array.isArray(rows)) return finish(new Error('Invalid model catalog'));
            for (const row of rows) {
              const id = provider === 'codex' ? row.model : row.value;
              if (
                typeof id !== 'string' ||
                !/^[a-zA-Z0-9][a-zA-Z0-9._:/+-]{0,199}$/.test(id) ||
                row.hidden
              )
                continue;
              if (!models.some((model) => model.id === id))
                models.push({
                  id,
                  label:
                    typeof row.displayName === 'string'
                      ? row.displayName
                      : typeof row.display_name === 'string'
                        ? row.display_name
                        : id,
                  provider,
                  local: false,
                  defaultForProvider: row.isDefault === true,
                });
            }
            if (provider === 'codex' && result.nextCursor) {
              if (cursors.has(result.nextCursor)) return finish(new Error('Repeated model cursor'));
              cursors.add(result.nextCursor);
              send({
                id: 2,
                method: 'model/list',
                params: { cursor: result.nextCursor, includeHidden: false },
              });
            } else {
              finish(models.length ? undefined : new Error('Empty model catalog'), models);
            }
          }
        } catch {
          /* Ignore CLI banners and non-protocol output. */
        }
      }
    });
    if (provider === 'codex')
      send({
        id: 1,
        method: 'initialize',
        params: {
          clientInfo: { name: 'shellysvn', version: '1.0.0' },
        },
      });
    else
      send({ type: 'control_request', request_id: 'models', request: { subtype: 'initialize' } });
  });
}
