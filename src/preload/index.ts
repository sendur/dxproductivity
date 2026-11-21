import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type {
  AppSettings,
  ConnectionTestResult,
  Dataset,
  SecretStatus,
  SecretsUpdate,
  SyncStatus
} from '../shared/types'

function subscribe<T>(channel: string, fn: (payload: T) => void): () => void {
  const handler = (_event: IpcRendererEvent, payload: T): void => fn(payload)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

const api = {
  settings: {
    get: (): Promise<AppSettings> => ipcRenderer.invoke('settings:get'),
    save: (settings: AppSettings, secrets: SecretsUpdate): Promise<AppSettings> =>
      ipcRenderer.invoke('settings:save', settings, secrets),
    secretStatus: (): Promise<SecretStatus> => ipcRenderer.invoke('secrets:status'),
    clearAll: (): Promise<void> => ipcRenderer.invoke('secrets:clearAll')
  },
  test: {
    dx: (baseUrl: string, token: string): Promise<ConnectionTestResult> =>
      ipcRenderer.invoke('test:dx', baseUrl, token),
    feed: (args: {
      baseUrl: string
      feedId: string
      feedToken: string
      variables: string
    }): Promise<ConnectionTestResult> => ipcRenderer.invoke('test:feed', args),
    bamboo: (subdomain: string, apiKey: string): Promise<ConnectionTestResult> =>
      ipcRenderer.invoke('test:bamboo', subdomain, apiKey)
  },
  data: {
    get: (): Promise<Dataset> => ipcRenderer.invoke('data:get'),
    loadSample: (): Promise<void> => ipcRenderer.invoke('data:loadSample'),
    clear: (): Promise<void> => ipcRenderer.invoke('data:clear'),
    onUpdated: (fn: () => void): (() => void) => subscribe('data:updated', fn)
  },
  sync: {
    status: (): Promise<SyncStatus> => ipcRenderer.invoke('sync:status'),
    now: (): Promise<SyncStatus> => ipcRenderer.invoke('sync:now'),
    onStatus: (fn: (status: SyncStatus) => void): (() => void) => subscribe('sync:status', fn)
  },
  exportCsv: (filename: string, csv: string): Promise<boolean> =>
    ipcRenderer.invoke('export:csv', filename, csv)
}

export type Api = typeof api

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
