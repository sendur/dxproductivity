import { dialog, ipcMain, type BrowserWindow } from 'electron'
import { writeFileSync } from 'fs'
import * as secureStore from './secureStore'
import * as settingsStore from './settingsStore'
import * as dataStore from './dataStore'
import * as sync from './sync'
import * as dxApi from './dxApi'
import * as bambooApi from './bambooApi'
import { buildSampleDataset } from './sampleData'
import type { AppSettings, ConnectionTestResult, SecretsUpdate } from '../shared/types'

export function registerIpcHandlers(getMainWindow: () => BrowserWindow | null): void {
  const send = (channel: string, payload?: unknown): void =>
    getMainWindow()?.webContents.send(channel, payload)

  let wasRunning = false
  sync.onStatus((status) => {
    send('sync:status', status)
    if (wasRunning && !status.running) send('data:updated')
    wasRunning = status.running
  })

  ipcMain.handle('settings:get', () => settingsStore.getSettings())

  ipcMain.handle('settings:save', (_event, settings: AppSettings, secrets: SecretsUpdate) => {
    secureStore.updateSecrets(secrets)
    const saved = settingsStore.saveSettings(settings)
    sync.schedule(sync.isConfigured())
    return saved
  })

  ipcMain.handle('secrets:status', () => secureStore.getSecretStatus())

  ipcMain.handle('secrets:clearAll', () => {
    secureStore.clearSecrets()
    dataStore.clear()
    sync.stop()
    send('data:updated')
  })

  ipcMain.handle(
    'test:dx',
    async (_event, baseUrl: string, token: string): Promise<ConnectionTestResult> => {
      const useToken = token || secureStore.getDxApiToken()
      if (!useToken) return { ok: false, message: 'Enter a DX API token first' }
      try {
        const teams = await dxApi.listTeams(baseUrl.replace(/\/+$/, ''), useToken)
        return { ok: true, message: `Connected — ${teams.length} teams found` }
      } catch (err) {
        return { ok: false, message: (err as Error).message }
      }
    }
  )

  ipcMain.handle(
    'test:feed',
    async (
      _event,
      args: { baseUrl: string; feedId: string; feedToken: string; variables: string }
    ): Promise<ConnectionTestResult> => {
      const dxToken = secureStore.getDxApiToken()
      const feedToken = args.feedToken || secureStore.getFeedToken(args.feedId)
      if (!dxToken) return { ok: false, message: 'Save a DX API token first' }
      if (!feedToken) return { ok: false, message: 'Enter the feed token first' }
      try {
        const rows = await dxApi.fetchDatafeed(
          args.baseUrl.replace(/\/+$/, ''),
          dxToken,
          feedToken,
          args.variables
        )
        const columns = rows[0] ? Object.keys(rows[0]).join(', ') : 'none'
        return { ok: true, message: `${rows.length} rows · columns: ${columns}` }
      } catch (err) {
        return { ok: false, message: (err as Error).message }
      }
    }
  )

  ipcMain.handle(
    'test:bamboo',
    async (_event, subdomain: string, apiKey: string): Promise<ConnectionTestResult> => {
      const key = apiKey || secureStore.getBambooApiKey()
      const sub = settingsStore.normalizeSubdomain(subdomain)
      if (!sub) return { ok: false, message: 'Enter your BambooHR company subdomain first' }
      if (!key) return { ok: false, message: 'Enter a BambooHR API key first' }
      try {
        const fields = await bambooApi.listFields(sub, key)
        return { ok: true, message: `Connected — ${fields.length} fields available`, fields }
      } catch (err) {
        return { ok: false, message: (err as Error).message }
      }
    }
  )

  ipcMain.handle('data:get', () => dataStore.getDataset())

  ipcMain.handle('data:loadSample', () => {
    const { engineers, ...metrics } = buildSampleDataset()
    dataStore.save(metrics, { engineers, hrTablesFetchedAt: null })
    send('data:updated')
  })

  ipcMain.handle('data:clear', () => {
    dataStore.clear()
    send('data:updated')
  })

  ipcMain.handle('sync:status', () => sync.getStatus())

  ipcMain.handle('sync:now', async () => {
    const status = await sync.runSync(true)
    sync.schedule()
    return status
  })

  ipcMain.handle('export:csv', async (_event, filename: string, csv: string) => {
    const window = getMainWindow()
    const options = {
      defaultPath: filename,
      filters: [{ name: 'CSV', extensions: ['csv'] }]
    }
    const result = window
      ? await dialog.showSaveDialog(window, options)
      : await dialog.showSaveDialog(options)
    if (result.canceled || !result.filePath) return false
    writeFileSync(result.filePath, csv, 'utf-8')
    return true
  })
}
