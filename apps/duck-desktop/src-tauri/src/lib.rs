use std::path::{Path, PathBuf};
use std::process::Command;

mod codex;
mod models;
mod request;
use request::{run_cli, RequestControl, Requests};

const COACHING_PROMPT: &str = "You are Rubber Duck, a read-only learning companion. Never edit files or provide paste-ready fixes. For debugging, ask one focused question and offer small hints grounded in files you read. For concept questions, explain in plain language first. Continue the provided conversation and keep replies concise.\n\n";

#[derive(Debug, PartialEq)]
enum Agent {
    Codex,
    Claude,
    Cursor,
}

fn agent_order(agent: &str) -> Result<&'static [Agent], String> {
    match agent {
        "auto" => Ok(&[Agent::Codex, Agent::Claude, Agent::Cursor]),
        "codex" => Ok(&[Agent::Codex]),
        "claude" => Ok(&[Agent::Claude]),
        "cursor" => Ok(&[Agent::Cursor]),
        _ => Err("Choose Auto, Codex, Claude Code, or Cursor.".into()),
    }
}

#[cfg(windows)]
use std::os::windows::process::CommandExt;

const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Strip whitespace and surrounding quotes from env values (Windows `.env` / UI copy-paste).
fn trim_env_path(raw: &str) -> String {
    raw.trim()
        .trim_matches(|c| c == '"' || c == '\'')
        .to_string()
}

/// Load `.env` into the process environment so `std::env::var("RUBBER_DUCK_*")` works.
/// Walks from `current_dir` up to parents (same idea as finding `AGENTS.md`).
fn load_dotenv_walking_parents() {
    let Ok(mut dir) = std::env::current_dir() else {
        return;
    };
    for _ in 0..17 {
        let path = dir.join(".env");
        if path.is_file() {
            let _ = dotenvy::from_path(&path);
            return;
        }
        let Some(parent) = dir.parent() else {
            break;
        };
        dir = parent.to_path_buf();
    }
}

/// Windows GUI apps often inherit a short PATH (no npm / Cursor). Prepend usual install dirs.
fn augment_path_env(cmd: &mut Command) {
    #[cfg(windows)]
    {
        let Ok(base) = std::env::var("PATH") else {
            return;
        };
        let mut prefix = String::new();
        if let Ok(app) = std::env::var("APPDATA") {
            prefix.push_str(&format!("{}\\npm;", app));
        }
        if let Ok(ld) = std::env::var("LOCALAPPDATA") {
            // Official Windows install: `irm .../install?win32=true | iex` → `%LOCALAPPDATA%\cursor-agent\agent.cmd`
            prefix.push_str(&format!("{ld}\\cursor-agent;"));
            // Put `resources\app\bin` before `Programs\cursor` so bare `cursor` / `cursor.exe`
            // resolve to the CLI shim, not `Cursor.exe` (same folder, case-insensitive FS).
            prefix.push_str(&format!("{ld}\\Programs\\cursor\\resources\\app\\bin;"));
            prefix.push_str(&format!("{ld}\\Programs\\cursor;"));
        }
        if let Ok(home) = std::env::var("USERPROFILE") {
            prefix.push_str(&format!("{}\\.local\\bin;", home));
        }
        let merged = format!("{}{}", prefix, base);
        cmd.env("PATH", merged);
    }
}

/// Optional: absolute path to repo root (folder containing `AGENTS.md`).
fn project_root() -> Option<PathBuf> {
    if let Ok(raw) = std::env::var("RUBBER_DUCK_PROJECT_ROOT") {
        let p = PathBuf::from(trim_env_path(&raw));
        if p.join("AGENTS.md").is_file() {
            return Some(p);
        }
    }
    let mut dir = std::env::current_dir().ok()?;
    for _ in 0..16 {
        if dir.join("AGENTS.md").is_file() {
            return Some(dir);
        }
        dir = dir.parent()?.to_path_buf();
    }
    None
}

fn trim_output(s: String) -> String {
    s.trim().to_string()
}

fn is_cli_noise_line(line: &str) -> bool {
    let t = line.trim();
    if t.is_empty() {
        return true;
    }
    if t.starts_with("(node:") && t.contains("DeprecationWarning") {
        return true;
    }
    if t.starts_with("Run with 'cursor -' to read output from another program") {
        return true;
    }
    let lower = t.to_ascii_lowercase();
    if lower.contains("--trace-deprecation") {
        return true;
    }
    if lower.contains("is not in the list of known options") && lower.contains("electron/chromium")
    {
        return true;
    }
    false
}

fn strip_cli_noise(s: &str) -> String {
    trim_output(
        s.lines()
            .filter(|line| !is_cli_noise_line(line))
            .collect::<Vec<_>>()
            .join("\n"),
    )
}

/// Prefer stdout; if empty, use stderr (Electron-based CLIs often print the answer on stderr).
fn headless_cli_text(stdout: &[u8], stderr: &[u8]) -> String {
    let out = trim_output(String::from_utf8_lossy(stdout).into_owned());
    let out = strip_cli_noise(&out);
    if !out.is_empty() {
        return out;
    }
    let err_raw = String::from_utf8_lossy(stderr);
    strip_cli_noise(&err_raw)
}

fn spawn_no_window(cmd: &mut Command) {
    #[cfg(windows)]
    {
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
}

/// On Windows, `CreateProcess` cannot run `.cmd` / `.bat` shims the same way shells do; npm
/// globals must go through `cmd.exe /C …`. Native `.exe` (e.g. `Cursor.exe`) stays direct.
fn cli_command(program: &Path) -> Command {
    #[cfg(windows)]
    {
        let direct_exe = program
            .extension()
            .and_then(|e| e.to_str())
            .is_some_and(|e| e.eq_ignore_ascii_case("exe"));

        if direct_exe {
            let mut cmd = Command::new(program);
            augment_path_env(&mut cmd);
            spawn_no_window(&mut cmd);
            return cmd;
        }

        let mut cmd = Command::new("cmd.exe");
        augment_path_env(&mut cmd);
        spawn_no_window(&mut cmd);
        cmd.arg("/C").arg(program);
        return cmd;
    }
    #[cfg(not(windows))]
    {
        let mut cmd = Command::new(program);
        augment_path_env(&mut cmd);
        cmd
    }
}

fn claude_programs() -> Vec<PathBuf> {
    let mut v = Vec::new();
    for key in ["RUBBER_DUCK_CLAUDE", "RUBBER_DUCK_CLAUDE_PATH"] {
        if let Ok(p) = std::env::var(key) {
            let pb = PathBuf::from(trim_env_path(&p));
            if !pb.as_os_str().is_empty() {
                v.push(pb);
            }
        }
    }
    #[cfg(windows)]
    {
        if let Ok(app) = std::env::var("APPDATA") {
            let npm_claude = PathBuf::from(app).join("npm").join("claude.cmd");
            if npm_claude.is_file() {
                v.push(npm_claude);
            }
        }
    }
    v.push(PathBuf::from("claude"));
    #[cfg(windows)]
    {
        v.push(PathBuf::from("claude.cmd"));
        v.push(PathBuf::from("claude.exe"));
    }
    v
}

fn configure_claude(cmd: &mut Command) {
    cmd.args([
        "--permission-mode",
        "plan",
        "--tools",
        "Read,Glob,Grep",
        "--strict-mcp-config",
        "--disable-slash-commands",
    ]);
}

/// Claude only gets file-reading and search tools, regardless of project permissions.
fn try_claude(root: &Path, user: &str, control: &RequestControl) -> Result<String, String> {
    let args = ["-p", "--max-turns", "6"];

    let mut last_spawn: Option<String> = None;
    let mut last_run: Option<String> = None;

    for program in claude_programs() {
        control.check()?;
        let mut cmd = cli_command(&program);
        cmd.current_dir(root).args(args);
        configure_claude(&mut cmd);

        let out = match run_cli(&mut cmd, user, control) {
            Ok(o) => o,
            Err(e) => {
                control.check()?;
                last_spawn = Some(format!("{}: {}", program.display(), e));
                continue;
            }
        };

        if !out.status.success() {
            let stderr = String::from_utf8_lossy(&out.stderr);
            let stdout = String::from_utf8_lossy(&out.stdout);
            last_run = Some(format!(
                "{} exit {}.\n{}\n{}",
                program.display(),
                out.status,
                stderr.trim(),
                stdout.trim()
            ));
            continue;
        }

        let text = headless_cli_text(&out.stdout, &out.stderr);
        if !text.is_empty() {
            return Ok(text);
        }
        last_run = Some(format!(
            "{} returned empty output (stderr): {}",
            program.display(),
            String::from_utf8_lossy(&out.stderr)
                .trim()
                .chars()
                .take(1200)
                .collect::<String>()
        ));
    }

    Err(last_run
        .or(last_spawn)
        .unwrap_or_else(|| String::from("no claude candidate ran")))
}

/// Cursor agent: prompt is the user’s question only (no `AGENTS.md`—lets the model answer normally).
fn try_cursor_agent(root: &Path, user: &str, control: &RequestControl) -> Result<String, String> {
    let mut last_spawn: Option<String> = None;
    let mut last_run: Option<String> = None;

    let mut agent_programs: Vec<PathBuf> = Vec::new();
    for key in ["RUBBER_DUCK_AGENT", "RUBBER_DUCK_CURSOR_AGENT"] {
        if let Ok(p) = std::env::var(key) {
            let pb = PathBuf::from(trim_env_path(&p));
            if !pb.as_os_str().is_empty() {
                agent_programs.push(pb);
            }
        }
    }
    agent_programs.push(PathBuf::from("agent"));
    #[cfg(windows)]
    {
        agent_programs.push(PathBuf::from("agent.cmd"));
        agent_programs.push(PathBuf::from("agent.exe"));
    }

    for program in agent_programs {
        control.check()?;
        let mut cmd = cli_command(&program);
        cmd.current_dir(root)
            .arg("--trust")
            .arg("-p")
            .arg("--output-format")
            .arg("text")
            .arg("--mode")
            .arg("ask");

        let out = match run_cli(&mut cmd, user, control) {
            Ok(o) => o,
            Err(e) => {
                control.check()?;
                last_spawn = Some(format!("{}: {}", program.display(), e));
                continue;
            }
        };

        if !out.status.success() {
            let stderr = String::from_utf8_lossy(&out.stderr);
            let stdout = String::from_utf8_lossy(&out.stdout);
            last_run = Some(format!(
                "{} exit {}.\n{}\n{}",
                program.display(),
                out.status,
                stderr.trim(),
                stdout.trim()
            ));
            continue;
        }

        let text = headless_cli_text(&out.stdout, &out.stderr);
        if !text.is_empty() {
            return Ok(text);
        }
        last_run = Some(format!(
            "{} returned empty output (stderr): {}",
            program.display(),
            String::from_utf8_lossy(&out.stderr)
                .trim()
                .chars()
                .take(1200)
                .collect::<String>()
        ));
    }

    // Do not let standalone `agent` failures mask Cursor spawn errors: `last_run.or(last_spawn)`
    // would keep a stale `last_run` if every `cursor … agent -p` attempt failed only at spawn.
    let standalone_agent_err = last_run.take().or(last_spawn.take());

    // `cursor agent -p "..."` (some installs only expose `cursor` on PATH)
    for cursor_bin in cursor_programs() {
        control.check()?;
        if is_cursor_gui_exe(&cursor_bin) {
            continue;
        }
        let mut cmd = cli_command(&cursor_bin);
        cmd.current_dir(root).args([
            "agent",
            "--trust",
            "-p",
            "--output-format",
            "text",
            "--mode",
            "ask",
        ]);

        let out = match run_cli(&mut cmd, user, control) {
            Ok(o) => o,
            Err(e) => {
                control.check()?;
                last_spawn = Some(format!("{} agent: {}", cursor_bin.display(), e));
                continue;
            }
        };

        if !out.status.success() {
            let stderr = String::from_utf8_lossy(&out.stderr);
            let stdout = String::from_utf8_lossy(&out.stdout);
            last_run = Some(format!(
                "{} agent exit {}.\n{}\n{}",
                cursor_bin.display(),
                out.status,
                stderr.trim(),
                stdout.trim()
            ));
            continue;
        }

        let text = headless_cli_text(&out.stdout, &out.stderr);
        if !text.is_empty() {
            return Ok(text);
        }
        last_run = Some(format!(
            "{} agent returned empty output (stderr): {}",
            cursor_bin.display(),
            String::from_utf8_lossy(&out.stderr)
                .trim()
                .chars()
                .take(1200)
                .collect::<String>()
        ));
    }

    let cursor_cli_err = last_run.or(last_spawn);
    match (standalone_agent_err, cursor_cli_err) {
        (Some(a), Some(c)) => Err(format!("{a}\n\n**Cursor (`… agent -p`)**:\n{c}")),
        (Some(a), None) => Err(a),
        (None, Some(c)) => Err(c),
        (None, None) => Err(String::from("no agent/cursor candidate ran")),
    }
}

/// The shipped GUI binary is `Cursor.exe`; `cursor agent -p …` must go through the shell shim
/// (`cursor` / `cursor.cmd` on PATH). Spawning `Cursor.exe` with those flags forwards them to
/// Chromium and produces bogus warnings without running the agent CLI.
fn is_cursor_gui_exe(path: &Path) -> bool {
    path.file_name()
        .and_then(|n| n.to_str())
        .is_some_and(|n| n == "Cursor.exe")
}

fn cursor_programs() -> Vec<PathBuf> {
    let mut v = Vec::new();

    if let Ok(p) = std::env::var("RUBBER_DUCK_CURSOR") {
        let pb = PathBuf::from(trim_env_path(&p));
        if !pb.as_os_str().is_empty() && !is_cursor_gui_exe(&pb) {
            v.push(pb);
        }
    }

    v.push(PathBuf::from("cursor"));
    #[cfg(windows)]
    {
        v.push(PathBuf::from("cursor.cmd"));
        v.push(PathBuf::from("cursor.exe"));
    }

    v
}

#[tauri::command]
async fn duck_ask(
    message: String,
    agent: String,
    request_id: u64,
    requests: tauri::State<'_, Requests>,
) -> Result<String, String> {
    let control = requests.start(request_id)?;
    let result =
        tauri::async_runtime::spawn_blocking(move || answer(&message, &agent, &control)).await;
    requests.finish(request_id)?;
    result.map_err(|_| "The request failed. Try asking again.".to_string())?
}

#[tauri::command]
fn duck_cancel(request_id: u64, requests: tauri::State<'_, Requests>) -> Result<(), String> {
    requests.cancel(request_id)
}

fn answer(message: &str, agent: &str, control: &RequestControl) -> Result<String, String> {
    let user = message.trim();
    if user.is_empty() {
        return Err(String::from("Type something first, then press Ask."));
    }

    let root = project_root().ok_or_else(|| {
        String::from(
            "Cannot find AGENTS.md. Run `npm run tauri:dev` from apps/duck-desktop, or set RUBBER_DUCK_PROJECT_ROOT to your repo root.",
        )
    })?;

    let agents_path = root.join("AGENTS.md");
    if !agents_path.is_file() {
        return Err(format!("Missing {}", agents_path.display()));
    }

    let prompt = format!("{COACHING_PROMPT}{user}");
    let mut errors = Vec::new();
    for agent in agent_order(agent)? {
        control.check()?;
        let (name, result) = match agent {
            Agent::Codex => ("Codex", codex::ask(&root, &prompt, control)),
            Agent::Claude => ("Claude Code", try_claude(&root, &prompt, control)),
            Agent::Cursor => ("Cursor", try_cursor_agent(&root, &prompt, control)),
        };
        control.check()?;
        match result {
            Ok(reply) => return Ok(reply),
            Err(error) => errors.push(format!("{name}:\n{error}")),
        }
    }
    Err(format!(
        "Could not get a reply from your local agent.\n\n{}\n\nInstall and sign in to Codex, Claude Code, or Cursor Agent CLI. Set RUBBER_DUCK_CODEX, RUBBER_DUCK_CLAUDE, or RUBBER_DUCK_AGENT if the executable is not on PATH. Restart the duck after changing environment variables.",
        errors.join("\n\n")
    ))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    load_dotenv_walking_parents();
    tauri::Builder::default()
        .manage(Requests::default())
        .invoke_handler(tauri::generate_handler![duck_ask, duck_cancel])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn explicit_agent_never_falls_back_to_another_provider() {
        assert_eq!(agent_order("codex").unwrap(), &[Agent::Codex]);
        assert_eq!(agent_order("claude").unwrap(), &[Agent::Claude]);
        assert_eq!(agent_order("cursor").unwrap(), &[Agent::Cursor]);
        assert_eq!(
            agent_order("auto").unwrap(),
            &[Agent::Codex, Agent::Claude, Agent::Cursor]
        );
        assert!(agent_order("powershell.exe").is_err());
    }

    #[test]
    fn cursor_editor_stdin_notice_is_not_an_answer() {
        let notice = b"Run with 'cursor -' to read output from another program (e.g. 'echo Hello World | cursor -').";
        assert_eq!(headless_cli_text(notice, b""), "");
    }

    #[cfg(windows)]
    #[test]
    fn cmd_shim_with_spaces_receives_literal_prompt() {
        let suffix = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("duck cli probe {suffix}"));
        std::fs::create_dir(&dir).unwrap();
        let shim = dir.join("assistant.cmd");
        std::fs::write(&shim, "@echo off\r\npowershell.exe -NoProfile -NonInteractive -Command \"[Console]::Out.Write([Console]::In.ReadToEnd())\"\r\n").unwrap();
        let mut cmd = cli_command(&shim);
        cmd.args(["-p", "--max-turns", "6"]);
        configure_claude(&mut cmd);
        let prompt = "Explain \"hello\" & echo NOPE | more > file %PATH%\nsecond line";
        let output = run_cli(
            &mut cmd,
            prompt,
            &RequestControl::new(std::time::Duration::from_secs(10)),
        )
        .unwrap();
        std::fs::remove_dir_all(&dir).unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        assert_eq!(String::from_utf8(output.stdout).unwrap(), prompt);
    }

    #[test]
    fn claude_only_gets_read_tools_in_plan_mode() {
        let mut cmd = Command::new("claude");
        configure_claude(&mut cmd);
        let args: Vec<_> = cmd.get_args().map(|arg| arg.to_string_lossy()).collect();
        assert!(args
            .windows(2)
            .any(|pair| pair == ["--permission-mode", "plan"]));
        assert!(args
            .windows(2)
            .any(|pair| pair == ["--tools", "Read,Glob,Grep"]));
        assert!(args.iter().any(|arg| arg == "--strict-mcp-config"));
        assert!(args.iter().any(|arg| arg == "--disable-slash-commands"));
        assert!(!args.iter().any(|arg| arg == "acceptEdits"));
    }
}
