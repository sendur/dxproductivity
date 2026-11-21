import { requestJson, HttpError } from './http'
import type { Row } from './transform'

// BambooHR API: https://documentation.bamboohr.com/reference — HTTP Basic auth with the
// API key as the username and any password.

function baseUrl(subdomain: string): string {
  return `https://api.bamboohr.com/api/gateway.php/${encodeURIComponent(subdomain)}/v1`
}

function authHeader(apiKey: string): Record<string, string> {
  return { Authorization: `Basic ${Buffer.from(`${apiKey}:x`).toString('base64')}` }
}

export async function listFields(subdomain: string, apiKey: string): Promise<string[]> {
  const fields = await requestJson<{ alias?: string; name?: string; id?: string | number }[]>(
    `${baseUrl(subdomain)}/meta/fields`,
    { headers: authHeader(apiKey), label: 'BambooHR fields' }
  )
  return fields
    .map((f) => f.alias || (f.id !== undefined ? String(f.id) : ''))
    .filter(Boolean)
    .sort()
}

/** One row per current employee with the requested fields (plus id). */
export async function employeeReport(
  subdomain: string,
  apiKey: string,
  fields: string[]
): Promise<Row[]> {
  const body = await requestJson<{ employees?: Row[] }>(
    `${baseUrl(subdomain)}/reports/custom?format=JSON&onlyCurrent=true`,
    {
      method: 'POST',
      headers: authHeader(apiKey),
      body: { title: 'DX Productivity sync', fields: [...new Set(['id', ...fields])] },
      label: 'BambooHR employee report'
    }
  )
  return body.employees ?? []
}

/**
 * Rows of a tabular field such as "compensation" or "jobInfo" for one employee, or null
 * when the API key isn't allowed to read that table.
 */
export async function employeeTable(
  subdomain: string,
  apiKey: string,
  employeeId: string,
  table: string
): Promise<Row[] | null> {
  try {
    const rows = await requestJson<Row[] | Record<string, Row>>(
      `${baseUrl(subdomain)}/employees/${encodeURIComponent(employeeId)}/tables/${table}`,
      { headers: authHeader(apiKey), label: `BambooHR ${table}` }
    )
    return Array.isArray(rows) ? rows : Object.values(rows)
  } catch (err) {
    // 404 = this employee has no rows in the table.
    if (err instanceof HttpError && err.status === 404) return []
    if (err instanceof HttpError && err.status === 403) return null
    throw err
  }
}
