# Rubber Duck (desktop)

Tauri 2 + React: a small frameless window with a pixel duck. Tap to open the panel, type a question, and **Ask the duck** runs a local CLI from your project root—no HTTP API keys in this app.

**Right now this is built for [Claude Code](https://docs.claude.com/en/docs/claude-code/cli-usage) and [Cursor’s headless CLI](https://cursor.com/docs/cli/headless).** Other tools are not wired in yet.

## How “Ask the duck” works

The app tries **Claude Code** first in plan mode, with only `Read`, `Glob`, and `Grep` available. It disables slash commands and inherited MCP servers for these requests. If Claude fails, it tries **`agent --trust -p --mode ask …`** or **`cursor agent --trust -p --mode ask …`**. Cursor stays in its read-only Ask mode; the app never passes `--force`.

- **Project root**: The process should see **`AGENTS.md`** in a parent folder. For a packaged build, set **`RUBBER_DUCK_PROJECT_ROOT`** to your clone (the folder that contains `AGENTS.md`).
- **Claude Code**: Install the CLI, run `claude auth login`, and ensure `claude` is on `PATH` when you start the duck.
- **Cursor**: Install the Cursor CLI and sign in (e.g. `agent login`). On Windows the app may prepend `%LOCALAPPDATA%\cursor-agent` to `PATH` so `agent` is found. Auth is whatever the CLI uses—this app does not store API keys.

Optional **`.env`** (first file found walking up from the working directory): `RUBBER_DUCK_CURSOR` and `RUBBER_DUCK_AGENT` can point at your `cursor.cmd` / `agent.cmd` if they are not on `PATH`.

## Prerequisites

- [Node.js](https://nodejs.org/) (recent LTS)
- [Rust](https://www.rust-lang.org/tools/install) and [Tauri 2 prerequisites](https://v2.tauri.app/start/prerequisites/)

## Development

```bash
cd apps/duck-desktop
npm install
npm run tauri:dev
```

`npm run tauri:*` goes through `scripts/tauri-env.mjs`, which sets **`CARGO_TARGET_DIR`** outside OneDrive by default on Windows to avoid MSVC PDB issues when the repo lives under OneDrive. Override with your own **`CARGO_TARGET_DIR`** if you want.

Pedagogy for assistants in the repo: [`AGENTS.md`](../../AGENTS.md) (the app only uses it to locate the project root; your message is not rewritten by that file).

## Icons

Regenerate tray/window icons from `public/duck.svg`:

```bash
npm run icons
```

Then rebuild. Trim extra generated files if you only ship the paths listed in `src-tauri/tauri.conf.json`.

## Production build

```bash
cd apps/duck-desktop
npm run tauri:build
```

Tap the duck for the panel, drag to move, close from the taskbar.
