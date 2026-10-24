use serde::{Deserialize, Serialize};
use std::sync::Mutex;

#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Ide {
    Codex,
    Claude,
    Cursor,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Model {
    pub id: String,
    pub label: String,
}

#[derive(Clone, Serialize)]
pub struct Catalog {
    pub ide: Ide,
    pub models: Vec<Model>,
    pub warning: Option<String>,
}

#[derive(Default)]
pub struct CatalogState(pub Mutex<Option<Catalog>>);

impl Catalog {
    pub fn validate(&self, model: &str) -> Result<(), String> {
        if (model.is_empty() && self.models.is_empty())
            || self.models.iter().any(|entry| entry.id == model)
        {
            Ok(())
        } else {
            Err("That model is not available in your current IDE. Refresh the model list.".into())
        }
    }
}

pub fn detect(env: &[(&str, &str)]) -> Result<Ide, String> {
    let value = |key| {
        env.iter()
            .find(|(name, _)| *name == key)
            .map(|(_, value)| *value)
            .unwrap_or("")
    };
    if !value("RUBBER_DUCK_IDE").is_empty() {
        return match value("RUBBER_DUCK_IDE") {
            "codex" => Ok(Ide::Codex),
            "claude" => Ok(Ide::Claude),
            "cursor" => Ok(Ide::Cursor),
            _ => Err("RUBBER_DUCK_IDE must be codex, claude, or cursor.".into()),
        };
    }
    if !value("CURSOR_TRACE_ID").is_empty()
        || !value("CURSOR_SESSION_ID").is_empty()
        || value("TERM_PROGRAM").eq_ignore_ascii_case("cursor")
        || value("VSCODE_IPC_HOOK_CLI")
            .to_ascii_lowercase()
            .contains("cursor")
    {
        return Ok(Ide::Cursor);
    }
    if value("CLAUDECODE") == "1" || !value("CLAUDE_CODE_ENTRYPOINT").is_empty() {
        return Ok(Ide::Claude);
    }
    if !value("CODEX_THREAD_ID").is_empty()
        || value("CODEX_INTERNAL_ORIGINATOR_OVERRIDE").contains("Codex")
    {
        return Ok(Ide::Codex);
    }
    Err("Could not detect your IDE. Launch the duck from your IDE's terminal, or set RUBBER_DUCK_IDE to codex, claude, or cursor.".into())
}

pub fn current_ide() -> Result<Ide, String> {
    let env: Vec<_> = std::env::vars().collect();
    let borrowed: Vec<_> = env
        .iter()
        .map(|(name, value)| (name.as_str(), value.as_str()))
        .collect();
    detect(&borrowed)
}

fn valid_id(id: &str) -> bool {
    id.chars().next().is_some_and(|c| c.is_ascii_alphanumeric())
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "._-:/[]()".contains(c))
}

fn checked(models: Vec<Model>) -> Result<Vec<Model>, String> {
    let mut result = Vec::new();
    for model in models {
        if valid_id(&model.id)
            && !model.label.trim().is_empty()
            && !result.iter().any(|item: &Model| item.id == model.id)
        {
            result.push(model);
        }
    }
    if result.is_empty() {
        Err("The IDE CLI did not return a usable model list.".into())
    } else {
        Ok(result)
    }
}

pub fn parse_codex(raw: &str) -> Result<Vec<Model>, String> {
    #[derive(Deserialize)]
    struct Entry {
        slug: String,
        display_name: String,
        visibility: String,
    }
    #[derive(Deserialize)]
    struct Response {
        models: Vec<Entry>,
    }
    let response: Response =
        serde_json::from_str(raw).map_err(|_| "Codex returned an invalid model catalog.")?;
    checked(
        response
            .models
            .into_iter()
            .filter(|model| model.visibility == "list")
            .map(|model| Model {
                id: model.slug,
                label: model.display_name,
            })
            .collect(),
    )
}

pub fn parse_claude(raw: &str) -> Result<Vec<Model>, String> {
    #[derive(Deserialize)]
    struct Entry {
        value: String,
        #[serde(rename = "displayName")]
        display_name: String,
    }
    #[derive(Deserialize)]
    struct Models {
        models: Vec<Entry>,
    }
    for line in raw.lines() {
        let Ok(value) = serde_json::from_str::<serde_json::Value>(line) else {
            continue;
        };
        if value["type"] != "control_response" || value["response"]["request_id"] != "duck-models" {
            continue;
        }
        let response: Models = serde_json::from_value(value["response"]["response"].clone())
            .map_err(|_| "Claude could not list account models.")?;
        return checked(
            response
                .models
                .into_iter()
                .filter(|model| {
                    model.value.starts_with("claude-")
                        || ["sonnet", "opus", "haiku", "fable", "best"]
                            .iter()
                            .any(|alias| {
                                model.value == *alias
                                    || model.value.starts_with(&format!("{alias}["))
                            })
                })
                .map(|model| Model {
                    id: model.value,
                    label: model.display_name,
                })
                .collect(),
        );
    }
    Err("Claude did not return its model catalog.".into())
}

pub fn parse_cursor(raw: &str) -> Result<Vec<Model>, String> {
    checked(
        raw.lines()
            .filter_map(|line| {
                let (id, label) = line.trim().split_once(" - ")?;
                Some(Model {
                    id: id.trim().to_owned(),
                    label: label.trim().to_owned(),
                })
            })
            .collect(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_the_launching_ide_and_never_guesses_from_installed_tools() {
        assert_eq!(
            detect(&[("CODEX_THREAD_ID", "thread")]).unwrap(),
            Ide::Codex
        );
        assert_eq!(detect(&[("CLAUDECODE", "1")]).unwrap(), Ide::Claude);
        assert_eq!(
            detect(&[("CURSOR_TRACE_ID", "trace"), ("CODEX_THREAD_ID", "nested")]).unwrap(),
            Ide::Cursor
        );
        assert_eq!(
            detect(&[("RUBBER_DUCK_IDE", "claude"), ("CODEX_THREAD_ID", "thread")]).unwrap(),
            Ide::Claude
        );
        assert!(detect(&[]).is_err());
        assert!(detect(&[("RUBBER_DUCK_IDE", "powershell")]).is_err());
    }

    #[test]
    fn codex_only_lists_visible_models_from_its_cli_catalog() {
        let catalog = parse_codex(r#"{"models":[{"slug":"gpt-example","display_name":"GPT Example","visibility":"list"},{"slug":"internal","display_name":"Internal","visibility":"hide"}]}"#).unwrap();
        assert_eq!(
            catalog,
            vec![Model {
                id: "gpt-example".into(),
                label: "GPT Example".into()
            }]
        );
        assert!(parse_codex("not JSON").is_err());
    }

    #[test]
    fn claude_only_lists_claude_models_reported_by_its_cli() {
        let raw = r#"{"type":"control_response","response":{"request_id":"duck-models","subtype":"success","response":{"models":[{"value":"sonnet","displayName":"Claude Sonnet"},{"value":"opus","displayName":"Claude Opus"},{"value":"gpt-example","displayName":"Other provider"}]}}}"#;
        let models = parse_claude(raw).unwrap();
        assert_eq!(
            models.iter().map(|m| m.id.as_str()).collect::<Vec<_>>(),
            ["sonnet", "opus"]
        );
    }

    #[test]
    fn cursor_keeps_all_model_families_reported_by_its_cli() {
        let models = parse_cursor("Available models\ngpt-example - GPT Example\nsonnet-example - Claude Example\ncomposer-example - Composer Example\n").unwrap();
        assert_eq!(models.len(), 3);
        assert_eq!(models[2].id, "composer-example");
        assert!(parse_cursor("Please sign in").is_err());
    }

    #[test]
    fn rejects_models_from_outside_the_current_ide_catalog() {
        let catalog = Catalog {
            ide: Ide::Codex,
            models: vec![Model {
                id: "gpt-example".into(),
                label: "GPT Example".into(),
            }],
            warning: None,
        };
        assert!(catalog.validate("gpt-example").is_ok());
        assert!(catalog.validate("claude-opus").is_err());
        assert!(catalog
            .validate("--dangerously-bypass-approvals-and-sandbox")
            .is_err());
        assert!(catalog.validate("").is_err());
        let unavailable = Catalog {
            ide: Ide::Codex,
            models: Vec::new(),
            warning: Some("Unavailable".into()),
        };
        assert!(unavailable.validate("").is_ok());
    }
}
