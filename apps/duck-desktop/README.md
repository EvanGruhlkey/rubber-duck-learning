# Rubber Duck (desktop)

Tauri 2 + React: a small frameless window with a pixel duck. Tap to open the panel, type a question, and **Ask the duck** runs a local CLI from your project root—no HTTP API keys in this app.

The duck detects the IDE it was launched from and shows that IDE's model list. Codex offers its ChatGPT models, Claude Code offers its Claude models, and Cursor offers all model families available through Cursor. The duck runs that IDE's signed-in CLI directly. It does not use an API SDK, ask for API keys, or store credentials.

## How “Ask the duck” works

The IDE label is fixed for the app session. The **Model** picker loads choices from that IDE's CLI, and **Reload** refreshes the list. A selected model is checked against the backend catalog before it is passed through `--model`. Requests never switch to another IDE or provider when a CLI fails.

IDE detection uses the launching environment: Cursor markers, Claude Code markers, then Codex markers. For a desktop shortcut or an environment without these markers, set `RUBBER_DUCK_IDE=codex`, `claude`, or `cursor` before launching. Detection does not guess from which tools happen to be installed or follow foreground-window changes.

Codex catalogs come from `codex debug models`, with hidden entries excluded. Claude catalogs come from its CLI initialization control response. Cursor catalogs come from `agent --list-models`. The first reported model is selected initially. If a CLI cannot report its models, the picker offers only **CLI default** with a warning. It never adds models from another provider or a hard-coded public catalog.

- **Codex**: Runs `codex app-server` over local standard input/output, with a read-only sandbox, no approval prompts, and an ephemeral thread. Assistant text streams directly into the panel. The CLI runs without the shared daemon so Stop terminates the request itself. Request overrides disable MCP servers, apps, plugins, and hooks; authentication uses your existing Codex login. **CLI default**, available only when discovery fails, omits the model override. Install a current CLI and sign in with `codex login`. The app checks PATH and the Codex desktop app's Windows CLI installation, or accepts `RUBBER_DUCK_CODEX` as an executable path. The streaming protocol follows the [Codex App Server documentation](https://learn.chatgpt.com/docs/app-server).
- **Claude Code**: Uses plan mode, with only `Read`, `Glob`, and `Grep` available. Slash commands and inherited MCP servers are disabled.
- **Cursor**: Uses `agent --trust -p --mode ask` or `cursor agent --trust -p --mode ask`. Cursor stays in its read-only Ask mode; the app never passes `--force`.

- **Project root**: Click the project name to choose a folder. New projects do not need Git or `AGENTS.md`. The selected folder is the CLI working directory. On first launch, `RUBBER_DUCK_PROJECT_ROOT` or a parent containing `AGENTS.md` supplies the initial folder when available.
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

Pedagogy for assistants in the repo: [`AGENTS.md`](../../AGENTS.md). The app supplies its own mode instructions to the CLI.

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

Chat is the main view. Choose **Ideate** to clarify an idea, **Build** to work through a plan, or **Debug** to investigate a failure. **Progress** opens the optional goal, checklist, and notes. Suggested plans require explicit adoption; only the learner checks off completed steps. The tutor remains read-only in every mode. Enter sends a message; Shift+Enter adds a line. The arrow sends, the square stops, and **…** appears until reply text arrives.

The **+** menu attaches a project file, pasted code, or an error. Each message accepts up to three attachments. Project files must be UTF-8 text inside the selected folder and no larger than 64 KiB. Attached snapshots remain visible with the submitted question. If CLI file tools are unavailable under the host's read-only policy, attach the relevant files explicitly.

Hiding the panel keeps your draft, replies, and any pending request. Each project's mode, goal, checklist, notes, draft, attachments, and latest 40 exchanges are saved in local WebView storage and restored on restart. Follow-ups include the latest eight exchanges. Storage failures appear in the panel. **New chat** clears the conversation and draft while retaining the goal, plan, and notes. The underlying CLI may also keep its own session logs.

Requests have a two-minute limit across all CLI attempts. Stop and timeout terminate the CLI process group, including child processes, and keep your question available to edit or retry. Requests run off the desktop UI thread. Codex streams assistant text deltas; Claude and Cursor forward text whenever their CLI flushes standard output. Prompts go through standard input so pasted quotes and shell characters stay literal text.

Run frontend regression tests with `npm test` and backend tests with `cargo test --manifest-path src-tauri/Cargo.toml`.
