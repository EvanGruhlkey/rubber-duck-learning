use serde::Serialize;
use std::io::Read;
use std::path::{Path, PathBuf};

const MAX_CONTEXT_BYTES: usize = 64 * 1024;

#[derive(Clone, Serialize)]
pub struct Project {
    pub root: String,
    pub name: String,
}

#[derive(Serialize)]
pub struct FileContext {
    pub path: String,
    pub text: String,
}

pub fn resolve(raw: &str) -> Result<Project, String> {
    let path = dunce::canonicalize(raw.trim())
        .map_err(|_| "That project folder does not exist or is not accessible.")?;
    if !path.is_dir() {
        return Err("Choose a project folder, not a file.".into());
    }
    let name = path
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.display().to_string());
    Ok(Project {
        root: path.to_string_lossy().into_owned(),
        name,
    })
}

pub fn read_context(root: &Path, path: &Path) -> Result<FileContext, String> {
    let root =
        dunce::canonicalize(root).map_err(|_| "The project folder is no longer available.")?;
    let path = dunce::canonicalize(path).map_err(|_| "That file is no longer available.")?;
    let relative = path
        .strip_prefix(&root)
        .map_err(|_| "Choose a file inside the selected project.")?;
    if !path.is_file() {
        return Err("Choose a text file.".into());
    }
    let mut bytes = Vec::new();
    std::fs::File::open(&path)
        .map_err(|_| "Could not open that file.")?
        .take((MAX_CONTEXT_BYTES + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|_| "Could not read that file.")?;
    if bytes.len() > MAX_CONTEXT_BYTES {
        return Err("Choose a file smaller than 64 KB, or paste the relevant selection.".into());
    }
    if bytes.contains(&0) {
        return Err("Choose a text file, or paste the relevant selection.".into());
    }
    let text = String::from_utf8(bytes)
        .map_err(|_| "This file is not UTF-8 text. Paste the relevant selection instead.")?;
    Ok(FileContext {
        path: relative.to_string_lossy().replace('\\', "/"),
        text,
    })
}

#[tauri::command]
pub async fn duck_project(path: Option<String>) -> Result<Project, String> {
    let path = match path {
        Some(path) => PathBuf::from(path),
        None => {
            let cwd = std::env::current_dir().map_err(|_| "Choose a project folder to start.")?;
            initial_root(
                &cwd,
                std::env::var("RUBBER_DUCK_PROJECT_ROOT").ok().as_deref(),
            )
        }
    };
    resolve(&path.to_string_lossy())
}

fn initial_root(cwd: &Path, configured: Option<&str>) -> PathBuf {
    if let Some(raw) = configured {
        let path = crate::trim_env_path(raw);
        if !path.is_empty() {
            return PathBuf::from(path);
        }
    }
    cwd.ancestors()
        .find(|dir| dir.join(".git").exists())
        .unwrap_or(cwd)
        .to_path_buf()
}

#[tauri::command]
pub async fn duck_choose_project(window: tauri::WebviewWindow) -> Result<Option<Project>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        rfd::FileDialog::new()
            .set_parent(&window)
            .set_title("Choose the project to learn in")
            .pick_folder()
            .map(|path| resolve(&path.to_string_lossy()))
            .transpose()
    })
    .await
    .map_err(|_| "Could not open the project picker.".to_string())?
}

#[tauri::command]
pub async fn duck_attach_file(
    project: String,
    path: Option<String>,
    window: tauri::WebviewWindow,
) -> Result<Option<FileContext>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = resolve(&project)?;
        let selected = path.map(PathBuf::from).or_else(|| {
            rfd::FileDialog::new()
                .set_parent(&window)
                .set_title("Choose context from this project")
                .set_directory(&root.root)
                .pick_file()
        });
        selected
            .map(|path| read_context(Path::new(&root.root), &path))
            .transpose()
    })
    .await
    .map_err(|_| "Could not open the file picker.".to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_git_roots_and_accepts_worktrees_and_folders_without_instructions() {
        let root = test_dir();
        let nested = root.join("src");
        std::fs::create_dir(&nested).unwrap();
        assert_eq!(initial_root(&nested, None), nested);
        assert_eq!(initial_root(&nested, Some(root.to_str().unwrap())), root);
        std::fs::create_dir(root.join(".git")).unwrap();
        assert_eq!(initial_root(&nested, None), root);
        std::fs::remove_dir(root.join(".git")).unwrap();
        std::fs::write(root.join(".git"), "gitdir: elsewhere").unwrap();
        assert_eq!(initial_root(&nested, None), root);
        std::fs::remove_file(root.join(".git")).unwrap();
        std::fs::remove_dir(&nested).unwrap();
        std::fs::remove_dir(&root).unwrap();
    }

    #[test]
    fn accepts_an_existing_project_without_agent_instructions() {
        let dir = test_dir();
        let project = resolve(dir.to_str().unwrap()).unwrap();
        assert_eq!(project.name, dir.file_name().unwrap().to_string_lossy());
        assert!(Path::new(&project.root).is_dir());
        assert!(resolve(dir.join("missing").to_str().unwrap()).is_err());
        std::fs::remove_dir(&dir).unwrap();
    }

    #[test]
    fn reads_project_text_but_rejects_traversal_binary_and_large_files() {
        let dir = test_dir();
        let outside = test_dir();
        std::fs::write(dir.join("main.rs"), "fn main() {}\n").unwrap();
        std::fs::write(outside.join("outside.txt"), "outside").unwrap();
        std::fs::write(dir.join("binary.bin"), b"a\0b").unwrap();
        std::fs::write(dir.join("large.txt"), vec![b'x'; MAX_CONTEXT_BYTES + 1]).unwrap();
        let context = read_context(&dir, &dir.join("main.rs")).unwrap();
        assert_eq!(context.path, "main.rs");
        assert_eq!(context.text, "fn main() {}\n");
        assert!(read_context(&dir, &outside.join("outside.txt")).is_err());
        assert!(read_context(&dir, &dir.join("binary.bin")).is_err());
        assert!(read_context(&dir, &dir.join("large.txt")).is_err());
        std::fs::remove_dir_all(dir).unwrap();
        std::fs::remove_dir_all(outside).unwrap();
    }

    fn test_dir() -> PathBuf {
        let id = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!("duck-project-{id}"));
        std::fs::create_dir(&path).unwrap();
        path
    }
}
