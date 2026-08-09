import type { IpcRenderer } from 'electron';
import type { IpcInvokeArgs, IpcInvokeChannel, IpcInvokeResult } from '@shared/ipc-contract';

export type InvokeIpc = <C extends IpcInvokeChannel>(
  channel: C,
  ...args: IpcInvokeArgs<C>
) => Promise<IpcInvokeResult<C>>;

export function createInvokeIpc(ipcRenderer: IpcRenderer): InvokeIpc {
  return (channel, ...args) =>
    ipcRenderer.invoke(channel, ...args) as Promise<IpcInvokeResult<typeof channel>>;
}

export function createOperationId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
