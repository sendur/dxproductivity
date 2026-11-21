---
name: run-desktop
description: Build, run, and drive the DX Productivity Electron desktop app headlessly. Use when asked to start the desktop app, take a screenshot of it, or interact with its UI in a container with no display.
---

DX Productivity is an Electron + React app. For agent/automated use, drive
it via the Playwright `_electron` REPL at `.claude/skills/run-desktop/driver.mjs`
under xvfb.

All paths are relative to the repo root.

## Prerequisites

Xvfb and `playwright-core` (not a project dependency, just needed for the
driver):

```bash
npm install --no-save playwright-core@1.63.0
```

## Build

```bash
npm install
npm run build   # produces ./out/{main,preload,renderer}
```

## Run (agent path)

```bash
xvfb-run -a node .claude/skills/run-desktop/driver.mjs
```

Wrap in tmux for interactive use:

```bash
tmux new-session -d -s app -x 200 -y 50
tmux send-keys -t app 'xvfb-run -a node .claude/skills/run-desktop/driver.mjs' Enter
timeout 20 bash -c 'until tmux capture-pane -t app -p | grep -q "driver>"; do sleep 0.2; done'
tmux send-keys -t app 'launch' Enter
timeout 30 bash -c 'until tmux capture-pane -t app -p | grep -q "launched"; do sleep 0.2; done'
tmux send-keys -t app 'ss landing' Enter
tmux capture-pane -t app -p
```

Screenshots land in `/tmp/shots/` (override: `SCREENSHOT_DIR`).

### Commands

| command                       | what it does                                           |
| ----------------------------- | ------------------------------------------------------ |
| `launch`                      | launch the app, wait for the window                    |
| `ss [name]`                   | screenshot -> `/tmp/shots/<name>.png`                  |
| `click <css-sel>`             | click element via DOM (not coordinates)                |
| `click-text <text>`           | click a button/link containing text (no quotes needed) |
| `fill <css-sel> <text>`       | set a React-controlled input's value and fire `input`  |
| `type <text>` / `press <key>` | keyboard input                                         |
| `wait <css-sel>`              | wait for element, 10s timeout                          |
| `eval <js>`                   | evaluate in the page, print JSON                       |
| `text [css-sel]`              | print innerText                                        |
| `windows`                     | list all windows + webContents                         |
| `quit`                        | close app, exit                                        |

## Run (human path)

```bash
npm run dev   # opens a real window; useless headless. Ctrl-C to quit.
```

## Gotchas

- **`tmux send-keys` sends quotes literally.** `click-text 'Save & Continue'`
  searches for the text `'Save & Continue'` (with quote characters) and
  fails. Send `click-text Save & Continue` with no quotes.
- **React-controlled inputs need the native setter trick.** Setting
  `el.value = x` directly doesn't notify React. The `fill` command uses
  `Object.getOwnPropertyDescriptor(...).set` + a dispatched `input` event
  instead of Playwright's `fill()`/`type()` on the DOM node.
- **No credentials needed to see the UI.** On the empty state, click
  `Explore with sample data` (`click-text Explore with sample data`) to load a
  deterministic fake org of 48 engineers and 7 teams with metrics, DORA data,
  salaries and promotions.
- **Real syncs need egress to `api.getdx.com` and `api.bamboohr.com`.** To exercise
  the sync path offline, mock both hosts from the main process before syncing:
  `app.evaluate(({ protocol }) => protocol.handle('https', handler))`. The main
  process uses `net.fetch`, which goes through session protocol handlers.
- **Isolate state** by launching with a throwaway `HOME`; settings, encrypted
  secrets and synced data live in `$HOME/.config/dxproductivity/`.

## Troubleshooting

- **Launch timeout (30s):** re-run `npm run build`, check `./out/main/index.js` exists.
- **"Missing X server":** forgot `xvfb-run`.
- **Stale Xvfb locks:** `rm -f /tmp/.X*-lock; pkill Xvfb`
