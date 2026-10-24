# Rubber Duck (desktop)

Tauri 2 + React: a small frameless window with a pixel duck. Tap to open the panel, type a question, and **Ask the duck** runs a local CLI from your project root—no HTTP API keys in this app.

Choose **Codex**, **Claude Code**, or **Cursor** in the Local agent picker. The duck runs your signed-in CLI directly. It does not use an API SDK, ask for API keys, or store credentials.

## How “Ask the duck” works

**Auto** tries Codex, Claude Code, then Cursor. Selecting an agent explicitly uses only that agent and reports its errors without falling back to another provider.

- **Codex**: Uses `codex exec` with the read-only sandbox, no approval prompts, and an ephemeral session. It runs without the shared daemon so Stop terminates the request itself. User configuration, MCP servers, apps, plugins, and hooks are disabled for the request; authentication still uses your existing Codex login. No model is forced. Install a current CLI and sign in with `codex login`. The app checks PATH and the Codex desktop app's Windows CLI installation, or accepts `RUBBER_DUCK_CODEX` as an executable path.
- **Claude Code**: Uses plan mode, with only `Read`, `Glob`, and `Grep` available. Slash commands and inherited MCP servers are disabled.
- **Cursor**: Uses `agent --trust -p --mode ask` or `cursor agent --trust -p --mode ask`. Cursor stays in its read-only Ask mode; the app never passes `--force`.

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

Hiding the panel keeps your draft, replies, and any pending request. Follow-up questions include the previous conversation. **New chat** clears it explicitly. Conversation state stays in memory for this app session and is not saved to disk by the duck; the underlying CLI may keep its own session logs.

While a request runs, the panel shows elapsed time and a **Stop** button. Requests have a two-minute limit across all CLI attempts. Stop and timeout terminate the CLI process group, including child processes, and keep your question available to edit or retry. Requests run off the desktop UI thread. Prompts go through standard input so pasted quotes and shell characters stay literal text.

Run frontend regression tests with `npm test` and backend tests with `cargo test --manifest-path src-tauri/Cargo.toml`.
