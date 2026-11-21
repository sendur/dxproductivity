import { net } from 'electron'

export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message)
  }
}

/** JSON request via Chromium's network stack, so system proxies and corporate CAs apply. */
export async function requestJson<T>(
  url: string,
  init: { method?: string; headers?: Record<string, string>; body?: unknown; label: string }
): Promise<T> {
  let response: Response
  try {
    response = await net.fetch(url, {
      method: init.method ?? 'GET',
      headers: {
        Accept: 'application/json',
        ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...init.headers
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined
    })
  } catch (err) {
    throw new Error(`${init.label}: network error (${(err as Error).message})`)
  }
  const text = await response.text()
  if (!response.ok) {
    const hint =
      response.status === 401 || response.status === 403 ? ' — check the API key/token' : ''
    throw new HttpError(
      `${init.label}: HTTP ${response.status}${hint}${text ? ` — ${text.slice(0, 200)}` : ''}`,
      response.status
    )
  }
  try {
    return (text ? JSON.parse(text) : {}) as T
  } catch {
    throw new Error(`${init.label}: response was not JSON`)
  }
}

/** Runs `fn` over `items` with at most `limit` in flight. */
export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++
      results[i] = await fn(items[i])
    }
  })
  await Promise.all(workers)
  return results
}
