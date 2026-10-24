use crate::{
    cli_command,
    request::{run_cli, RequestControl},
    trim_env_path,
};
use std::path::{Path, PathBuf};
use std::process::Command;

fn configure(cmd: &mut Command) {
    cmd.args([
        "--no-daemon",
        "--ask-for-approval",
        "never",
        "exec",
        "--sandbox",
        "read-only",
        "--ephemeral",
        "--ignore-user-config",
        "--disable",
        "apps",
        "--disable",
        "plugins",
        "--disable",
        "hooks",
        "-c",
        "mcp_servers={}",
        "--color",
        "never",
        "-",
    ]);
}

fn programs() -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    if let Ok(raw) = std::env::var("RUBBER_DUCK_CODEX") {
        candidates.push(PathBuf::from(trim_env_path(&raw)));
    }
    if let Some(path) = std::env::var_os("PATH") {
        for dir in std::env::split_paths(&path) {
            #[cfg(windows)]
            for name in ["codex.exe", "codex.cmd"] {
                candidates.push(dir.join(name));
            }
            #[cfg(not(windows))]
            candidates.push(dir.join("codex"));
        }
    }
    #[cfg(windows)]
    {
        if let Ok(local) = std::env::var("LOCALAPPDATA") {
            let bin = PathBuf::from(local).join("OpenAI/Codex/bin");
            if let Ok(entries) = std::fs::read_dir(bin) {
                let mut entries: Vec<_> = entries.flatten().collect();
                entries.sort_by_key(|entry| {
                    std::cmp::Reverse(entry.metadata().and_then(|m| m.modified()).ok())
                });
                candidates.extend(
                    entries
                        .into_iter()
                        .map(|entry| entry.path().join("codex.exe")),
                );
            }
        }
        if let Ok(app) = std::env::var("APPDATA") {
            candidates.push(PathBuf::from(app).join("npm/codex.cmd"));
        }
    }
    let mut programs = Vec::new();
    for path in candidates {
        if path.is_file() && !programs.contains(&path) {
            programs.push(path);
        }
    }
    programs
}

pub fn ask(root: &Path, prompt: &str, control: &RequestControl) -> Result<String, String> {
    let programs = programs();
    if programs.is_empty() {
        return Err(
            "Codex CLI was not found. Install Codex or set RUBBER_DUCK_CODEX to its executable."
                .into(),
        );
    }
    let mut last_error = String::new();
    for program in programs {
        control.check()?;
        let mut cmd = cli_command(&program);
        cmd.current_dir(root);
        configure(&mut cmd);
        let output = match run_cli(&mut cmd, prompt, control) {
            Ok(output) => output,
            Err(error) => {
                control.check()?;
                last_error = format!("{}: {error}", program.display());
                continue;
            }
        };
        // Codex sends progress and diagnostics to stderr, and only its answer to stdout.
        if !output.status.success() {
            return Err(format!(
                "Codex exited with {}.\n{}",
                output.status,
                String::from_utf8_lossy(&output.stderr).trim()
            ));
        }
        let reply = String::from_utf8_lossy(&output.stdout).trim().to_owned();
        return if reply.is_empty() {
            Err("Codex returned no answer. Check `codex login status` in a terminal.".into())
        } else {
            Ok(reply)
        };
    }
    Err(last_error)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn codex_is_read_only_ephemeral_and_runs_without_the_shared_daemon() {
        let mut cmd = Command::new("codex");
        configure(&mut cmd);
        let args: Vec<_> = cmd.get_args().map(|arg| arg.to_string_lossy()).collect();
        assert!(args.iter().any(|arg| arg == "--no-daemon"));
        assert!(args.iter().any(|arg| arg == "exec"));
        assert!(args.iter().any(|arg| arg == "--ephemeral"));
        assert!(args.iter().any(|arg| arg == "--ignore-user-config"));
        assert!(args
            .windows(2)
            .any(|pair| pair == ["--sandbox", "read-only"]));
        assert!(args
            .windows(2)
            .any(|pair| pair == ["--ask-for-approval", "never"]));
        for feature in ["apps", "plugins", "hooks"] {
            assert!(args.windows(2).any(|pair| pair == ["--disable", feature]));
        }
        assert_eq!(args.last().map(|arg| arg.as_ref()), Some("-"));
    }
}
