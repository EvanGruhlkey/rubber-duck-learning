use crate::{
    cli_command,
    request::{run_cli, RequestControl},
    trim_env_path,
};
use std::path::{Path, PathBuf};

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

pub fn list_models(
    root: &Path,
    control: &RequestControl,
) -> Result<Vec<crate::models::Model>, String> {
    let program = programs()
        .into_iter()
        .next()
        .ok_or("Codex CLI was not found.")?;
    let mut cmd = cli_command(&program);
    cmd.current_dir(root).args(["debug", "models"]);
    let output = run_cli(&mut cmd, "", control)?;
    if !output.status.success() {
        return Err("Codex could not list its models. Check its login in your IDE.".into());
    }
    crate::models::parse_codex(&String::from_utf8_lossy(&output.stdout))
}

pub fn ask(
    root: &Path,
    prompt: &str,
    model: &str,
    control: &RequestControl,
) -> Result<String, String> {
    let programs = programs();
    if programs.is_empty() {
        return Err(
            "Codex CLI was not found. Install Codex or set RUBBER_DUCK_CODEX to its executable."
                .into(),
        );
    }
    let program = &programs[0];
    let mut cmd = cli_command(program);
    cmd.current_dir(root);
    crate::codex_stream::configure(&mut cmd);
    crate::codex_stream::ask(&mut cmd, root, prompt, model, control)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Command;

    #[test]
    #[ignore = "requires a signed-in Codex CLI and RUBBER_DUCK_TEST_MODEL"]
    fn streams_a_real_cli_reply() {
        use std::{
            sync::{Arc, Mutex},
            time::{Duration, Instant},
        };
        let root = std::env::current_dir().unwrap();
        let model = std::env::var("RUBBER_DUCK_TEST_MODEL").expect("choose an available CLI model");
        let control = RequestControl::new(Duration::from_secs(120));
        let start = Instant::now();
        let chunks = Arc::new(Mutex::new(Vec::new()));
        let observed = chunks.clone();
        control.stream_to(move |text| observed.lock().unwrap().push((start.elapsed(), text)));
        let answer = ask(
            &root,
            "Explain a for loop in six short sentences. Do not use tools.",
            &model,
            &control,
        )
        .unwrap();
        let chunks = chunks.lock().unwrap();
        assert!(
            chunks
                .iter()
                .any(|(_, text)| !text.is_empty() && text.len() < answer.len()),
            "the CLI must stream partial text before the final answer"
        );
        assert_eq!(chunks.last().unwrap().1.trim(), answer);
        println!(
            "{} CLI chunks, completed in {:?}",
            chunks.len(),
            start.elapsed()
        );
    }

    #[test]
    fn codex_is_read_only_ephemeral_and_runs_without_the_shared_daemon() {
        let mut cmd = Command::new("codex");
        crate::codex_stream::configure(&mut cmd);
        let args: Vec<_> = cmd.get_args().map(|arg| arg.to_string_lossy()).collect();
        assert!(args.iter().any(|arg| arg == "--no-daemon"));
        assert!(args.iter().any(|arg| arg == "app-server"));
        assert!(args.iter().any(|arg| arg == "sandbox_mode=\"read-only\""));
        assert!(args
            .windows(2)
            .any(|pair| pair == ["--ask-for-approval", "never"]));
        for feature in ["apps", "plugins", "hooks"] {
            assert!(args.windows(2).any(|pair| pair == ["--disable", feature]));
        }
    }
}
