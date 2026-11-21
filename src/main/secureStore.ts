import { app, safeStorage } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'fs'
import type { SecretStatus, SecretsUpdate } from '../shared/types'

interface Secrets {
  dxApiToken?: string
  bambooApiKey?: string
  feedTokens?: Record<string, string>
}

export function userDataFile(name: string): string {
  const dir = app.getPath('userData')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return join(dir, name)
}

export function readJson<T>(name: string, fallback: T): T {
  const path = userDataFile(name)
  if (!existsSync(path)) return fallback
  try {
    return JSON.parse(readFileSync(path, 'utf-8'))
  } catch {
    return fallback
  }
}

export function writeJson(name: string, data: unknown): void {
  // Write-then-rename so a crash mid-write never leaves a truncated file behind.
  const path = userDataFile(name)
  writeFileSync(`${path}.tmp`, JSON.stringify(data), 'utf-8')
  renameSync(`${path}.tmp`, path)
}

export function encrypt(value: string): string {
  if (safeStorage.isEncryptionAvailable()) {
    return safeStorage.encryptString(value).toString('base64')
  }
  // Fallback for environments without an OS keychain (e.g. some headless Linux setups).
  // Prefixed so we never mistake it for real ciphertext when decrypting.
  return `plain:${Buffer.from(value, 'utf-8').toString('base64')}`
}

export function decrypt(stored: string): string {
  if (stored.startsWith('plain:')) {
    return Buffer.from(stored.slice('plain:'.length), 'base64').toString('utf-8')
  }
  return safeStorage.decryptString(Buffer.from(stored, 'base64'))
}

/** Reads a JSON value that was saved with writeEncryptedJson. */
export function readEncryptedJson<T>(name: string, fallback: T): T {
  const stored = readJson<{ data?: string }>(name, {})
  if (!stored.data) return fallback
  try {
    return JSON.parse(decrypt(stored.data))
  } catch {
    return fallback
  }
}

export function writeEncryptedJson(name: string, data: unknown): void {
  writeJson(name, { data: encrypt(JSON.stringify(data)) })
}

const SECRETS_FILE = 'secrets.json'

function getSecrets(): Secrets {
  return readEncryptedJson<Secrets>(SECRETS_FILE, {})
}

export function updateSecrets(update: SecretsUpdate): void {
  const secrets = getSecrets()
  // Empty strings mean "leave unchanged" so the settings form never has to round-trip secrets.
  if (update.dxApiToken) secrets.dxApiToken = update.dxApiToken.trim()
  if (update.bambooApiKey) secrets.bambooApiKey = update.bambooApiKey.trim()
  if (update.feedTokens) {
    secrets.feedTokens = { ...secrets.feedTokens }
    for (const [feedId, token] of Object.entries(update.feedTokens)) {
      if (token) secrets.feedTokens[feedId] = token.trim()
    }
  }
  writeEncryptedJson(SECRETS_FILE, secrets)
}

export function removeFeedToken(feedId: string): void {
  const secrets = getSecrets()
  if (!secrets.feedTokens?.[feedId]) return
  delete secrets.feedTokens[feedId]
  writeEncryptedJson(SECRETS_FILE, secrets)
}

export function clearSecrets(): void {
  writeEncryptedJson(SECRETS_FILE, {})
}

export function getDxApiToken(): string | null {
  return getSecrets().dxApiToken ?? null
}

export function getBambooApiKey(): string | null {
  return getSecrets().bambooApiKey ?? null
}

export function getFeedToken(feedId: string): string | null {
  return getSecrets().feedTokens?.[feedId] ?? null
}

export function getSecretStatus(): SecretStatus {
  const secrets = getSecrets()
  return { dxApiToken: !!secrets.dxApiToken, bambooApiKey: !!secrets.bambooApiKey }
}
