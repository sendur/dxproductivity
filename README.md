# DX Productivity

A desktop app (Electron + React + TypeScript) that keeps pulling engineering
productivity metrics from [DX](https://getdx.com) and joins them with salary
and promotion history from BambooHR. You can slice the numbers by engineer,
team, level, role type, employment type and metric category, see who is
getting real value from AI, and track DORA metrics per team.

## Features

- **Continuous sync.** Pulls on launch, then on a schedule you set (default
  hourly) while the app is open. Each sync adds to the stored history, so
  trends build up over time.
- **Explore.** Pick a metric, group by any dimension, and choose average,
  median, p75, total, min or max. You get a ranked bar chart, a trend line
  across the filtered engineers, and a breakdown table with headcount,
  average salary and promotion rate per group.
- **AI Impact.** A 2×2 with AI usage across and performance down, one dot per
  engineer. It splits engineers into **AI-accelerated** (use AI and outperform),
  **AI, not yet effective** (use AI but trail on speed or accuracy) and **not
  using AI** (split into strong and trailing). It also has segment counts, the
  mix per team/level/role, and a sortable list of engineers. See
  [How AI segments work](#how-ai-segments-work).
- **DORA.** The four keys (deployment frequency, lead time for changes,
  change failure rate, failed deployment recovery time) for the org and per
  team. Each is rated Elite / High / Medium / Low against the DORA benchmarks,
  with trends and each team's AI adoption alongside. See
  [How DORA works](#how-dora-works).
- **Scorecard.** A matrix of groups × metrics, filterable by metric category
  (Speed / Quality / Effectiveness / Impact / AI / Other) and sortable by any
  column.
- **Engineers.** A searchable, sortable roster. Click anyone to see their
  team path, level, salary, job history (with promotions marked), compensation
  history, and a sparkline per metric compared with the median for their level.
- **Filters.** Time window, team group, team, level, role type and
  employment type apply to every view.
- CSV export from every view, and a **Hide compensation** toggle that blurs
  salaries while you share your screen.
- **Explore with sample data** lets you try the app before entering any keys.

## Where each field comes from

| Field                      | Source                                                                                                                                    |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Metrics                    | DX Data Studio queries pulled through the `queries.datafeed` Web API, one row per engineer or one row per team                            |
| Team and team group        | DX teams (`teams.list` + `teams.info`). An engineer is placed on the deepest team they belong to, and the group is the top-level ancestor |
| Name, job title, hire date | BambooHR employee report                                                                                                                  |
| Level                      | A BambooHR field you choose. If none is set, it's derived from the job title (`L4`, `IC3`, Senior, Staff, Principal…)                     |
| Role type                  | A BambooHR field you choose. If none is set, ordered keyword rules are matched against the job title (editable in Settings)               |
| Employment type            | BambooHR `employmentHistoryStatus` by default (Full-Time, Contractor…)                                                                    |
| Salary                     | The latest effective row of the BambooHR **Compensation** table, annualized (hourly × 2080, monthly × 12, …)                              |
| Promotions                 | Every job-title change between consecutive rows of the BambooHR **Job Information** table                                                 |

DX and BambooHR records are joined on **work email** (case-insensitive).

## How AI segments work

The AI Impact view needs **one AI usage metric** from DX. Examples: AI tool
active days per week, % of AI-assisted code, or Copilot / Cursor / Claude Code
sessions. Any feed column named after an AI tool (`ai_…`, `copilot_…`,
`cursor_…`, `claude_…`) is put in the **AI** category automatically.

- **Using AI** means the AI metric is above a threshold (default: anything
  above 0). Engineers with no AI data count as non-users by default, because DX
  AI feeds usually list only active users. You can turn that off.
- **Performance** averages the metrics you pick. Use at least one
  **velocity** metric (e.g. PRs merged, higher is better) and one **accuracy**
  metric (e.g. change failure rate, lower is better). That way fast but
  error-prone AI use lands in "not yet effective". Defaults are picked from
  your metric names. You can adjust them under **Adjust method**.
- Choose one of two scoring modes:
  - **Percentile vs. peers** (default): each engineer is ranked against
    others **at the same level**, so seniors aren't compared with juniors. The
    split is the median.
  - **Change over the time window**: the % change from the first half of
    the window to the second, so the split is no change. This shows who
    actually got _faster_ after adopting AI. Use a 90-day or longer window and
    a datafeed with a period column.
- Global filters (team, level, role, employment type, time window) apply, so
  you can compare segments within one team or one level.

This shows correlation, not causation, so use it to start conversations
about coaching and enablement, not as a verdict on any one person.

## How DORA works

DORA metrics describe teams and their delivery pipeline, not individuals.
The best source is a DX datafeed with **one row per team** (in Settings,
set the feed's **Rows are** to _One per team_). It needs:

- a team column holding the DX team name or id (any column with "team" in
  its name is detected automatically)
- any of: deployments, lead time, change failure rate, time to restore
  (columns with those names are mapped and put in the **DORA** category
  automatically)
- ideally a period column (e.g. `week`) so trends build up

You can also map per-engineer metrics. They're rolled up by team:
deployments are added up, and the other keys use the team's typical value.
Units (per day/week/month, minutes/hours/days, % or 0–1 ratio) are guessed
from the column names and can be changed under **Adjust mapping**.

Levels follow the DORA State of DevOps benchmarks:

| Key                   | Elite         | High           | Medium          | Low               |
| --------------------- | ------------- | -------------- | --------------- | ----------------- |
| Deployment frequency  | daily or more | weekly or more | monthly or more | less than monthly |
| Lead time for changes | under a day   | under a week   | under a month   | a month or more   |
| Change failure rate   | 5% or less    | 10% or less    | 15% or less     | over 15%          |
| Recovery time         | under an hour | under a day    | under a week    | a week or more    |

A team's overall level is the middle of its four levels, rounding toward the
weaker one. The team and team-group filters apply to the DORA view. The level,
role and employment filters don't.

## 1. Get your keys

You'll enter these in the app's **Settings** screen. Nothing goes in this repo.

**DX API token.** In DX, go to Settings → Web API and create a token. It
needs to read teams (`snapshots:read`) and queries.

**DX datafeed tokens, one per query.** In DX Data Studio, write or open a
query, share it as a datafeed and copy its `feed_token`. For per-engineer
queries, return **one row per engineer** (optionally one per engineer per
week or month). Each row needs:

- an email column (any column with "email" in its name is detected
  automatically)
- one or more numeric columns. Every numeric column becomes a metric
- optionally a period column (e.g. `week`). Without one, each sync is
  stored as that day's value

You can add as many feeds as you like and give each a default metric
category. After the first sync, you can also re-categorize individual
columns. Datafeeds return at most 1,000 rows. If you have many engineers ×
periods, split the query or narrow it with template variables, and the app
will warn you when a feed hits the limit.

Example query shapes (table and column names are illustrative, so adapt them
to your DX schema):

```sql
-- per engineer
select u.email, date_trunc('week', p.merged_at)::date as week,
       count(*) as prs_merged,
       avg(extract(epoch from p.merged_at - p.created_at) / 3600) as cycle_time_hours
from pull_requests p join dx_users u on u.id = p.dx_user_id
where p.merged_at > now() - interval '12 weeks'
group by 1, 2;

-- per team (DORA)
select t.name as team, date_trunc('week', d.deployed_at)::date as week,
       count(*) as deployments_per_week,
       avg(d.lead_time_seconds) / 3600 as lead_time_hours,
       100.0 * avg(case when d.caused_incident then 1 else 0 end) as change_failure_pct,
       avg(i.time_to_restore_seconds) / 3600 as time_to_restore_hours
from deployments d join teams t on t.id = d.team_id
left join incidents i on i.deployment_id = d.id
where d.deployed_at > now() - interval '12 weeks'
group by 1, 2;
```

**BambooHR API key and subdomain.** In BambooHR, click your avatar → API
Keys → Add New Key. The key has the same access you do, so it needs
permission to read the Compensation and Job Information tables. Your
subdomain is the `acme` in `https://acme.bamboohr.com`. You can also paste
the whole URL. Click **Test & load fields** to check the key and get
suggestions for the level and role-type fields.

## 2. Install and run

```bash
npm install
npm run dev
```

Open **Settings**, enter the keys above and click **Save settings**. The
first sync starts a few seconds later. **Sync now** in the top bar forces a
full refresh, including BambooHR compensation and job tables. Scheduled
syncs re-pull those tables at most every 12 hours.

## 3. Build a distributable

```bash
npm run build:mac   # or build:win / build:linux
```

## Development

```bash
npm test          # unit tests for parsing, joins, AI segments and DORA
npm run typecheck
npm run lint
```

## Project structure

```
src/
  main/              Electron main process
    sync.ts            Sync orchestration + continuous scheduler
    dxApi.ts           DX Web API client (teams, datafeeds)
    bambooApi.ts       BambooHR client (employee report, compensation/jobInfo tables)
    transform.ts       Pure parsing: datafeed rows → metrics, levels, role types, promotions
    secureStore.ts     Encrypted local storage for keys
    dataStore.ts       Local metric history + encrypted people data
    settingsStore.ts   Non-secret settings
    sampleData.ts      Fake org for "Explore with sample data"
    ipcHandlers.ts     IPC surface exposed to the renderer
  preload/           contextBridge bridge (window.api)
  renderer/          React UI (Explore, AI Impact, DORA, Scorecard, Engineers, Settings)
    src/utils/aiSegments.ts  AI usage × performance classification
    src/utils/dora.ts        DORA mapping, units, levels and team/org rollups
  shared/            Types and defaults shared by main and renderer
test/                Vitest unit tests
```

## Security notes

- The DX token, feed tokens and BambooHR key are encrypted with Electron's
  `safeStorage` (macOS Keychain / Windows DPAPI / libsecret). They're stored
  in the app's user-data folder and never sent to the UI process.
- Synced people data (salaries, job and compensation history) is encrypted
  the same way. The metric history is stored as plain JSON.
- If the OS provides no encryption (some headless Linux setups), values are
  stored base64-encoded instead. Treat that environment as less secure.
- The app talks only to `api.getdx.com` (or the base URL you set) and
  `api.bamboohr.com`.
- **Settings → Remove all keys & data** wipes everything from the computer.
