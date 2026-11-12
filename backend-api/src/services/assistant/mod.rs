//! The in-app assistant: the model answers the user's question by calling
//! Cadenza's own read functions as tools.
//!
//! One request runs the whole loop: send the conversation, run the tools the
//! model asks for, send their results back, and repeat until the model writes
//! an answer or [`MAX_STEPS`] runs out. The phone keeps the conversation and
//! sends all of it each time, so nothing is stored between messages.

pub mod model;
pub mod prompt;
pub mod tools;

use chrono::Utc;
use sea_orm::{DatabaseConnection, prelude::Uuid};
use serde_json::{Value, json};

use crate::db;
use crate::err::CadenzaError;
use crate::routes::json::assistant::{
    AssistantRequest, AssistantResponse, AssistantStep, ChatRole, SongsCard,
};
use crate::services::analytics::sanitize_timezone;

use model::AssistantModel;
use tools::{DbTools, ToolRunner, definitions, describe_activity_tags, describe_tags};

/// The most model calls one message may take. Each tool round is one.
pub const MAX_STEPS: usize = 8;
/// The most earlier messages sent along, newest kept.
const MAX_HISTORY: usize = 30;
/// The longest a single message may be, in characters.
const MAX_MESSAGE_CHARS: usize = 4000;

const OUT_OF_STEPS_REPLY: &str =
    "Sorry, I couldn't finish that one. Try asking in a simpler way, or one part at a time.";

/// Answers the last user message in `request` as `user_id`.
pub async fn answer(
    db: &DatabaseConnection,
    model: &dyn AssistantModel,
    user_id: Uuid,
    request: AssistantRequest,
) -> Result<AssistantResponse, CadenzaError> {
    let input = to_input(&request)?;

    let tags = db::tags::get_all_user_tags(db, user_id).await?;
    let activity_tags = db::activity_tags::get_activity_tags(db).await?;
    let hide_explicit = db::settings::get_settings(db, user_id).await?.hide_explicit;
    let time_zone = sanitize_timezone(request.time_zone.as_deref().unwrap_or("UTC"));
    let now = request
        .now
        .clone()
        .filter(|now| now.len() <= 64)
        .unwrap_or_else(|| Utc::now().to_rfc3339());
    let instructions = prompt::instructions(
        &now,
        time_zone,
        &describe_tags(&tags),
        &describe_activity_tags(&activity_tags),
    );

    let runner = DbTools {
        db,
        user_id,
        hide_explicit,
    };
    run_loop(model, &runner, &instructions, input, &definitions()).await
}

/// The conversation as Responses API input items, oldest first.
///
/// Rejects an empty conversation or one whose last message is not the user's.
/// Drops all but the last [`MAX_HISTORY`] messages and cuts each to
/// [`MAX_MESSAGE_CHARS`], so a long chat cannot run up the bill.
fn to_input(request: &AssistantRequest) -> Result<Vec<Value>, CadenzaError> {
    let Some(last) = request.messages.last() else {
        return Err(CadenzaError::InvalidRequestBody(
            "messages must not be empty".to_owned(),
        ));
    };
    if last.role != ChatRole::User {
        return Err(CadenzaError::InvalidRequestBody(
            "the last message must be the user's".to_owned(),
        ));
    }
    if last.content.trim().is_empty() {
        return Err(CadenzaError::InvalidRequestBody(
            "the last message is empty".to_owned(),
        ));
    }

    let start = request.messages.len().saturating_sub(MAX_HISTORY);
    Ok(request.messages[start..]
        .iter()
        .filter(|message| !message.content.trim().is_empty())
        .map(|message| {
            let content: String = message.content.chars().take(MAX_MESSAGE_CHARS).collect();
            let role = match message.role {
                ChatRole::User => "user",
                ChatRole::Assistant => "assistant",
            };
            json!({ "role": role, "content": content })
        })
        .collect())
}

/// The tool loop. Returns the model's answer with the steps it took and the
/// songs from the last tool that found any.
pub async fn run_loop(
    model: &dyn AssistantModel,
    runner: &dyn ToolRunner,
    instructions: &str,
    mut input: Vec<Value>,
    tools: &[Value],
) -> Result<AssistantResponse, CadenzaError> {
    let mut steps: Vec<AssistantStep> = Vec::new();
    let mut songs: Option<SongsCard> = None;

    for _ in 0..MAX_STEPS {
        let turn = model.respond(instructions, &input, tools).await?;

        if turn.calls.is_empty() {
            return Ok(AssistantResponse::Reply {
                text: turn.text.unwrap_or_else(|| OUT_OF_STEPS_REPLY.to_owned()),
                steps,
                songs,
            });
        }

        for call in turn.calls {
            let outcome = runner.run(&call.name, &call.arguments).await;
            input.push(call.to_input_item());
            input.push(json!({
                "type": "function_call_output",
                "call_id": call.call_id,
                "output": outcome.output.to_string(),
            }));
            // the same tool twice in a row is one row on the phone
            if steps.last().is_none_or(|last| last.tool != call.name) {
                steps.push(AssistantStep {
                    tool: call.name,
                    label: outcome.label,
                });
            }
            if outcome.songs.is_some() {
                songs = outcome.songs;
            }
        }
    }

    Ok(AssistantResponse::Reply {
        text: OUT_OF_STEPS_REPLY.to_owned(),
        steps,
        songs,
    })
}

#[cfg(test)]
mod tests {
    use std::collections::VecDeque;
    use std::sync::Mutex;

    use sea_orm::prelude::async_trait::async_trait;

    use super::*;
    use crate::routes::json::assistant::ChatMessage;
    use model::{FunctionCall, ModelTurn};
    use tools::ToolOutcome;

    /// Replies with each scripted turn in order, and keeps the input it was sent.
    struct ScriptedModel {
        turns: Mutex<VecDeque<ModelTurn>>,
        inputs: Mutex<Vec<Vec<Value>>>,
    }

    impl ScriptedModel {
        fn new(turns: Vec<ModelTurn>) -> Self {
            Self {
                turns: Mutex::new(turns.into()),
                inputs: Mutex::new(Vec::new()),
            }
        }

        fn calls_made(&self) -> usize {
            self.inputs.lock().unwrap().len()
        }
    }

    #[async_trait]
    impl AssistantModel for ScriptedModel {
        async fn respond(
            &self,
            _instructions: &str,
            input: &[Value],
            _tools: &[Value],
        ) -> Result<ModelTurn, CadenzaError> {
            self.inputs.lock().unwrap().push(input.to_vec());
            Ok(self
                .turns
                .lock()
                .unwrap()
                .pop_front()
                .unwrap_or_else(|| call("list_tags", "{}")))
        }
    }

    /// Answers every tool with a fixed output, and finds songs for `run_query`.
    struct FakeTools;

    #[async_trait]
    impl ToolRunner for FakeTools {
        async fn run(&self, name: &str, _arguments: &str) -> ToolOutcome {
            ToolOutcome {
                output: json!({ "ran": name }),
                label: format!("Ran {name}"),
                songs: (name == "run_query").then(|| SongsCard {
                    song_ids: vec!["1".into(), "2".into()],
                    total: 2,
                    capped: false,
                }),
            }
        }
    }

    fn call(name: &str, arguments: &str) -> ModelTurn {
        ModelTurn {
            text: None,
            calls: vec![FunctionCall {
                call_id: format!("call_{name}"),
                name: name.into(),
                arguments: arguments.into(),
            }],
        }
    }

    fn text(text: &str) -> ModelTurn {
        ModelTurn {
            text: Some(text.into()),
            calls: vec![],
        }
    }

    fn user(content: &str) -> ChatMessage {
        ChatMessage {
            role: ChatRole::User,
            content: content.into(),
        }
    }

    fn assistant(content: &str) -> ChatMessage {
        ChatMessage {
            role: ChatRole::Assistant,
            content: content.into(),
        }
    }

    fn request(messages: Vec<ChatMessage>) -> AssistantRequest {
        AssistantRequest {
            messages,
            time_zone: None,
            now: None,
        }
    }

    async fn run(model: &ScriptedModel) -> AssistantResponse {
        let input = vec![json!({ "role": "user", "content": "hi" })];
        run_loop(model, &FakeTools, "instructions", input, &[])
            .await
            .unwrap()
    }

    #[tokio::test]
    async fn answers_straight_away_without_tools() {
        let model = ScriptedModel::new(vec![text("Hello.")]);
        assert_eq!(
            run(&model).await,
            AssistantResponse::Reply {
                text: "Hello.".into(),
                steps: vec![],
                songs: None,
            }
        );
        assert_eq!(model.calls_made(), 1);
    }

    #[tokio::test]
    async fn runs_a_tool_then_sends_its_output_back() {
        let model = ScriptedModel::new(vec![call("run_query", "{}"), text("You have 2 songs.")]);
        let response = run(&model).await;

        assert_eq!(
            response,
            AssistantResponse::Reply {
                text: "You have 2 songs.".into(),
                steps: vec![AssistantStep {
                    tool: "run_query".into(),
                    label: "Ran run_query".into(),
                }],
                songs: Some(SongsCard {
                    song_ids: vec!["1".into(), "2".into()],
                    total: 2,
                    capped: false,
                }),
            }
        );

        // the second request carries the call and its output after the user's message
        let inputs = model.inputs.lock().unwrap();
        let second = &inputs[1];
        assert_eq!(second.len(), 3);
        assert_eq!(second[1]["type"], "function_call");
        assert_eq!(second[1]["call_id"], "call_run_query");
        assert_eq!(second[2]["type"], "function_call_output");
        assert_eq!(second[2]["call_id"], "call_run_query");
        assert_eq!(second[2]["output"], r#"{"ran":"run_query"}"#);
    }

    #[tokio::test]
    async fn stops_after_max_steps() {
        // the scripted model asks for a tool forever
        let model = ScriptedModel::new(vec![]);
        let AssistantResponse::Reply { text, steps, .. } = run(&model).await else {
            panic!("expected a reply");
        };
        assert_eq!(text, OUT_OF_STEPS_REPLY);
        assert_eq!(model.calls_made(), MAX_STEPS);
        // one row for the repeated tool, not eight
        assert_eq!(steps.len(), 1);
    }

    #[tokio::test]
    async fn keeps_one_row_per_run_of_the_same_tool() {
        let model = ScriptedModel::new(vec![
            call("list_tags", "{}"),
            call("run_query", "{}"),
            call("run_query", "{}"),
            text("Done."),
        ]);
        let AssistantResponse::Reply { steps, .. } = run(&model).await else {
            panic!("expected a reply");
        };
        let tools: Vec<&str> = steps.iter().map(|step| step.tool.as_str()).collect();
        assert_eq!(tools, ["list_tags", "run_query"]);
    }

    #[test]
    fn input_keeps_both_roles_in_order() {
        let input = to_input(&request(vec![
            user("how many tags?"),
            assistant("14."),
            user("which are basic?"),
        ]))
        .unwrap();
        assert_eq!(
            input,
            vec![
                json!({ "role": "user", "content": "how many tags?" }),
                json!({ "role": "assistant", "content": "14." }),
                json!({ "role": "user", "content": "which are basic?" }),
            ]
        );
    }

    #[test]
    fn input_must_end_with_the_user() {
        assert!(to_input(&request(vec![])).is_err());
        assert!(to_input(&request(vec![user("hi"), assistant("hello")])).is_err());
        assert!(to_input(&request(vec![user("   ")])).is_err());
    }

    #[test]
    fn input_drops_old_messages_and_cuts_long_ones() {
        let mut messages: Vec<ChatMessage> = (0..MAX_HISTORY + 10)
            .map(|i| user(&format!("message {i}")))
            .collect();
        messages.push(user(&"a".repeat(MAX_MESSAGE_CHARS + 100)));

        let input = to_input(&request(messages)).unwrap();
        assert_eq!(input.len(), MAX_HISTORY);
        assert_eq!(
            input.last().unwrap()["content"].as_str().unwrap().len(),
            MAX_MESSAGE_CHARS
        );
    }
}
