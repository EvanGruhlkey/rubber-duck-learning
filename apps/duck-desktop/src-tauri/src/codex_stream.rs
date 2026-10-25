use crate::request::{converse_cli, Dialogue, RequestControl};
use serde_json::{json, Value};
use std::{path::Path, process::Command};

fn line(value: Value) -> String {
    format!("{value}\n")
}

pub fn configure(cmd: &mut Command) {
    cmd.args([
        "--no-daemon",
        "--ask-for-approval",
        "never",
        "app-server",
        "--listen",
        "stdio://",
        "--disable",
        "apps",
        "--disable",
        "plugins",
        "--disable",
        "hooks",
        "-c",
        "mcp_servers={}",
        "-c",
        "sandbox_mode=\"read-only\"",
        "-c",
        "approval_policy=\"never\"",
    ]);
}

pub fn ask(
    cmd: &mut Command,
    root: &Path,
    prompt: &str,
    model: &str,
    control: &RequestControl,
) -> Result<String, String> {
    let initialize = line(
        json!({"id":0,"method":"initialize","params":{"clientInfo":{"name":"rubber_duck","version":"0.1.0"},"capabilities":null}}),
    );
    let mut reply = Reply::default();
    let mut thread_id = String::new();
    converse_cli(
        cmd,
        &initialize,
        |raw| {
            let event: Value = serde_json::from_str(raw)
                .map_err(|_| "Codex returned an invalid streaming event.")?;
            if let Some(error) = event.get("error") {
                return Err(format!(
                    "Codex: {}",
                    error
                        .get("message")
                        .and_then(Value::as_str)
                        .unwrap_or("request failed")
                ));
            }
            match event.get("id").and_then(Value::as_u64) {
                Some(0) => {
                    return Ok(Dialogue::Send(format!(
                        "{}{}",
                        line(json!({"method":"initialized"})),
                        line(
                            json!({"id":1,"method":"config/read","params":{"cwd":root,"includeLayers":false}})
                        )
                    )))
                }
                Some(1) => {
                    let config = thread_config(&event)?;
                    return Ok(Dialogue::Send(line(
                        json!({"id":2,"method":"thread/start","params":{
                            "cwd":root,"model":if model.is_empty() {None} else {Some(model)},"approvalPolicy":"never","sandbox":"read-only","ephemeral":true,
                            "config":config
                        }}),
                    )));
                }
                Some(2) => {
                    if event
                        .pointer("/result/sandbox/type")
                        .and_then(Value::as_str)
                        != Some("readOnly")
                        || event
                            .pointer("/result/approvalPolicy")
                            .and_then(Value::as_str)
                            != Some("never")
                    {
                        return Err("Codex could not establish a read-only session.".into());
                    }
                    thread_id = event
                        .pointer("/result/thread/id")
                        .and_then(Value::as_str)
                        .ok_or("Codex did not start a thread.")?
                        .to_owned();
                    return Ok(Dialogue::Send(line(
                        json!({"id":3,"method":"mcpServerStatus/list","params":{"threadId":thread_id,"limit":100}}),
                    )));
                }
                Some(3) => {
                    let servers = event
                        .pointer("/result/data")
                        .and_then(Value::as_array)
                        .ok_or("Codex could not verify disabled integrations.")?;
                    if event
                        .pointer("/result/nextCursor")
                        .is_some_and(|cursor| !cursor.is_null())
                        || servers.iter().any(|server| {
                            server.get("runtimeStatus").and_then(Value::as_str) != Some("disabled")
                        })
                    {
                        return Err(
                            "Codex integrations could not be disabled for this read-only request."
                                .into(),
                        );
                    }
                    return Ok(Dialogue::Send(line(
                        json!({"id":4,"method":"turn/start","params":{"threadId":thread_id,"input":[{"type":"text","text":prompt,"text_elements":[]}],"approvalPolicy":"never"}}),
                    )));
                }
                _ => {}
            }
            // Unexpected approval/tool requests must never hang or obtain write access.
            if event.get("id").is_some() && event.get("method").is_some() {
                return Ok(Dialogue::Send(line(
                    json!({"id":event["id"],"error":{"code":-32601,"message":"Rubber Duck is read-only; interactive requests are unavailable."}}),
                )));
            }
            reply.accept(&event, control)
        },
        control,
    )
}

fn thread_config(event: &Value) -> Result<serde_json::Map<String, Value>, String> {
    let config = event
        .pointer("/result/config")
        .and_then(Value::as_object)
        .ok_or("Codex could not read its integration configuration.")?;
    let mut overrides = serde_json::Map::new();
    for feature in ["apps", "plugins", "hooks"] {
        overrides.insert(format!("features.{feature}"), json!(false));
    }
    if let Some(servers) = config.get("mcp_servers") {
        for name in servers
            .as_object()
            .ok_or("Codex returned an invalid integration configuration.")?
            .keys()
        {
            if name.is_empty()
                || !name
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
            {
                return Err("A configured Codex integration name cannot be safely overridden for read-only tutoring.".into());
            }
            overrides.insert(format!("mcp_servers.{name}.enabled"), json!(false));
        }
    }
    Ok(overrides)
}

#[derive(Default)]
struct Reply {
    text: String,
}

impl Reply {
    fn accept(&mut self, event: &Value, control: &RequestControl) -> Result<Dialogue, String> {
        match event.get("method").and_then(Value::as_str) {
            Some("item/started")
                if event.pointer("/params/item/type").and_then(Value::as_str)
                    == Some("agentMessage") =>
            {
                self.text.clear();
                control.publish(String::new());
            }
            Some("item/agentMessage/delta") => {
                let delta = event
                    .pointer("/params/delta")
                    .and_then(Value::as_str)
                    .ok_or("Codex sent an invalid text chunk.")?;
                if self.text.len() < 400_000 {
                    self.text.push_str(delta);
                }
                control.publish(self.text.chars().take(100_000).collect());
            }
            Some("item/completed")
                if event.pointer("/params/item/type").and_then(Value::as_str)
                    == Some("agentMessage") =>
            {
                self.text = event
                    .pointer("/params/item/text")
                    .and_then(Value::as_str)
                    .ok_or("Codex returned an invalid reply.")?
                    .chars()
                    .take(100_000)
                    .collect();
                control.publish(self.text.clone());
            }
            Some("turn/completed") => {
                if event.pointer("/params/turn/status").and_then(Value::as_str) != Some("completed")
                {
                    return Err(event
                        .pointer("/params/turn/error/message")
                        .and_then(Value::as_str)
                        .unwrap_or("Codex did not complete its reply.")
                        .into());
                }
                if self.text.trim().is_empty() {
                    return Err("Codex returned no answer.".into());
                }
                return Ok(Dialogue::Done(self.text.trim().to_owned()));
            }
            _ => {}
        }
        Ok(Dialogue::Continue)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        sync::{Arc, Mutex},
        time::Duration,
    };

    #[test]
    fn explicitly_disables_inherited_mcp_servers_without_mutating_their_config() {
        let config = json!({"result":{"config":{"mcp_servers":{"node_repl":{"command":"node"},"project-tools":{"url":"https://example.invalid"}}}}});
        let overrides = thread_config(&config).unwrap();
        assert_eq!(
            overrides.get("mcp_servers.node_repl.enabled"),
            Some(&json!(false))
        );
        assert_eq!(
            overrides.get("mcp_servers.project-tools.enabled"),
            Some(&json!(false))
        );
        assert!(config
            .pointer("/result/config/mcp_servers/node_repl/enabled")
            .is_none());
        assert!(
            thread_config(&json!({"result":{"config":{"mcp_servers":{"ambiguous.name":{}}}}}))
                .is_err()
        );
    }
    #[test]
    fn forwards_only_assistant_text_and_finishes_with_the_final_reply() {
        let chunks = Arc::new(Mutex::new(Vec::new()));
        let observed = chunks.clone();
        let control = RequestControl::new(Duration::from_secs(2));
        control.stream_to(move |text| observed.lock().unwrap().push(text));
        let mut reply = Reply::default();
        reply
            .accept(
                &json!({"method":"item/reasoning/textDelta","params":{"delta":"private"}}),
                &control,
            )
            .unwrap();
        reply
            .accept(
                &json!({"method":"item/agentMessage/delta","params":{"delta":"A loop"}}),
                &control,
            )
            .unwrap();
        reply
            .accept(
                &json!({"method":"item/agentMessage/delta","params":{"delta":" repeats."}}),
                &control,
            )
            .unwrap();
        assert_eq!(*chunks.lock().unwrap(), ["A loop", "A loop repeats."]);
        let done = reply
            .accept(
                &json!({"method":"turn/completed","params":{"turn":{"status":"completed"}}}),
                &control,
            )
            .unwrap();
        assert!(matches!(done, Dialogue::Done(text) if text == "A loop repeats."));
        assert!(reply.accept(&json!({"method":"turn/completed","params":{"turn":{"status":"failed","error":{"message":"rate limited"}}}}), &control).is_err());
    }
}
