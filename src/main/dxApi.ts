import { requestJson, mapLimit } from './http'
import { parseDatafeed, type DxTeam, type Row } from './transform'

// DX Web API: https://docs.getdx.com/webapi/overview — bearer-token auth, Slack-style
// method names (teams.list, queries.datafeed, ...) that return `{ ok, ... }`.

interface DxEnvelope {
  ok?: boolean
  error?: string
}

async function call<T extends DxEnvelope>(
  baseUrl: string,
  token: string,
  method: string,
  params: Record<string, string> = {}
): Promise<T> {
  const query = new URLSearchParams(params).toString()
  const body = await requestJson<T>(`${baseUrl}/${method}${query ? `?${query}` : ''}`, {
    headers: { Authorization: `Bearer ${token}` },
    label: `DX ${method}`
  })
  if (body.ok === false) throw new Error(`DX ${method}: ${body.error ?? 'request failed'}`)
  return body
}

interface RawTeam {
  id?: string | number
  name?: string
  parent_id?: string | number | null
  parentId?: string | number | null
}

interface RawContributor {
  email?: string
  name?: string
}

export async function listTeams(baseUrl: string, token: string): Promise<DxTeam[]> {
  const body = await call<DxEnvelope & { teams?: RawTeam[] }>(baseUrl, token, 'teams.list')
  return (body.teams ?? [])
    .filter((t) => t.id !== undefined)
    .map((t) => {
      const parent = t.parent_id ?? t.parentId
      return {
        id: String(t.id),
        name: t.name ?? String(t.id),
        parentId: parent === null || parent === undefined ? null : String(parent)
      }
    })
}

/** email -> ids of every team the engineer is listed under. */
export async function teamMembership(
  baseUrl: string,
  token: string,
  teams: DxTeam[]
): Promise<{ membership: Map<string, string[]>; names: Map<string, string> }> {
  const membership = new Map<string, string[]>()
  const names = new Map<string, string>()
  await mapLimit(teams, 4, async (team) => {
    const body = await call<
      DxEnvelope & { team?: { contributors?: RawContributor[]; members?: RawContributor[] } }
    >(baseUrl, token, 'teams.info', { team_id: team.id })
    const people = body.team?.contributors ?? body.team?.members ?? []
    for (const person of people) {
      const email = person.email?.trim().toLowerCase()
      if (!email) continue
      membership.set(email, [...(membership.get(email) ?? []), team.id])
      if (person.name) names.set(email, person.name)
    }
  })
  return { membership, names }
}

export async function fetchDatafeed(
  baseUrl: string,
  token: string,
  feedToken: string,
  variables: string
): Promise<Row[]> {
  const params: Record<string, string> = { feed_token: feedToken }
  if (variables.trim()) {
    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(variables)
    } catch {
      throw new Error('Template variables must be a JSON object')
    }
    for (const [key, value] of Object.entries(parsed)) params[key] = String(value)
  }
  const body = await call<DxEnvelope>(baseUrl, token, 'queries.datafeed', params)
  return parseDatafeed(body)
}
