/// <reference types="vite/client" />

import type { ElectronAPI } from '@shared/types'

declare global {
  interface Window {
    electron: {
      ipcRenderer: {
        send: (channel: string, ...args: unknown[]) => void
        invoke: (channel: string, ...args: unknown[]) => Promise<unknown>
        on: (channel: string, listener: (...args: unknown[]) => void) => () => void
      }
      process: {
        platform: NodeJS.Platform
        versions: {
          node: string
          chrome: string
          electron: string
        }
      }
    }
    api: ElectronAPI
  }
}

export {}
