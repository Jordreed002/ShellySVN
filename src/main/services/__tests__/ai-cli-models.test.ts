import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { describe, it, expect, vi, afterEach } from 'vitest';
const { spawn, terminate } = vi.hoisted(() => ({
  spawn: vi.fn(),
  terminate: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('node:child_process', () => ({
  default: { spawn },
  spawn,
  spawnSync: () => {
    throw new Error('Synchronous process forbidden');
  },
}));
vi.mock('../../utils/process-tree', () => ({ terminateProcessTree: terminate }));
import { discoverCliModels } from '../ai-cli-models';
afterEach(() => vi.useRealTimers());
function child() {
  const process = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
  });
  spawn.mockReturnValue(process);
  return process;
}
describe('CLI model discovery', () => {
  it('handshakes with Codex and reads provider model ids', async () => {
    const process = child();
    const pending = discoverCliModels('codex', { command: 'codex', prefixArgs: [] }, {});
    process.stdout.write('{"id":1,"result":{}}\n');
    process.stdout.write(
      '{"id":2,"result":{"data":[{"model":"new-model","displayName":"New model"}]}}\n'
    );
    expect(await pending).toEqual([
      expect.objectContaining({ id: 'new-model', label: 'New model' }),
    ]);
    expect(terminate).toHaveBeenCalled();
  });
  it('reads Claude initialize models without sending a prompt', async () => {
    const process = child();
    const pending = discoverCliModels('claude', { command: 'claude', prefixArgs: [] }, {});
    expect(process.stdin.read().toString()).toContain('"subtype":"initialize"');
    process.stdout.write(
      '{"type":"control_response","response":{"request_id":"models","response":{"models":[{"value":"opus-new","displayName":"Opus new"}]}}}\n'
    );
    expect(await pending).toEqual([expect.objectContaining({ id: 'opus-new' })]);
  });
  it('times out an unresponsive CLI asynchronously and terminates it', async () => {
    vi.useFakeTimers();
    child();
    const pending = discoverCliModels('codex', { command: 'codex', prefixArgs: [] }, {});
    const assertion = expect(pending).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(15_000);
    await assertion;
  });
});
