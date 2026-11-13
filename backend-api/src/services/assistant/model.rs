//! The model behind the assistant, behind a trait so the tool loop can be
//! tested without calling OpenAI.

use std::{env, time::Duration};

use reqwest::{Client, StatusCode};
use sea_orm::prelude::async_trait::async_trait;
use serde::Deserialize;
use serde_json::{Value, json};

use crate::err::CadenzaError;
use crate::services::tag_generation::openai_tag_generator::{
    OPENAI_RESPONSES_URL, rate_limit_wait,
};

/// The assistant's own model, separate from tag generation's, so either can
/// change without the other.
const ASSISTANT_MODEL: &str = "gpt-4o-mini";
const OPENAI_HTTP_TIMEOUT_SECS: u64 = 60;

/// One reply from the model: text, tool calls, or both.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct ModelTurn {
    /// The model's text, when it wrote any. An empty string counts as none.
    pub text: Option<String>,
    /// The tools the model asked for, in order.
    pub calls: Vec<FunctionCall>,
}

/// A tool call the model asked for.
#[derive(Debug, Clone, PartialEq)]
pub struct FunctionCall {
    /// Ties the call to its output in the next request.
    pub call_id: String,
    pub name: String,
    /// The arguments as the model wrote them: a JSON string, possibly invalid.
    pub arguments: String,
}

impl FunctionCall {
    /// The call as an input item, for the next request.
    pub fn to_input_item(&self) -> Value {
        json!({
            "type": "function_call",
            "call_id": self.call_id,
            "name": self.name,
            "arguments": self.arguments,
        })
    }
}

#[async_trait]
pub trait AssistantModel: Send + Sync {
    /// Sends `instructions`, the conversation in `input`, and the `tools` the
    /// model may call, and returns what the model said back.
    async fn respond(
        &self,
        instructions: &str,
        input: &[Value],
        tools: &[Value],
    ) -> Result<ModelTurn, CadenzaError>;
}

/// The assistant on OpenAI's Responses API. Reads `OPENAI_API_KEY`, the same
/// key tag generation uses.
pub struct OpenAiAssistantModel {
    api_key: String,
    http_client: Client,
}

impl OpenAiAssistantModel {
    pub fn new() -> Self {
        Self {
            api_key: env::var("OPENAI_API_KEY").expect("error getting OPENAI_API_KEY env var"),
            http_client: Client::builder()
                .timeout(Duration::from_secs(OPENAI_HTTP_TIMEOUT_SECS))
                .build()
                .expect("failed to build http client for OpenAiAssistantModel"),
        }
    }
}

#[async_trait]
impl AssistantModel for OpenAiAssistantModel {
    async fn respond(
        &self,
        instructions: &str,
        input: &[Value],
        tools: &[Value],
    ) -> Result<ModelTurn, CadenzaError> {
        let body = json!({
            "model": ASSISTANT_MODEL,
            "instructions": instructions,
            "input": input,
            "tools": tools,
            // the phone keeps the conversation, so openai does not need to
            "store": false,
        });

        let resp = self
            .http_client
            .post(OPENAI_RESPONSES_URL)
            .header("Authorization", format!("Bearer {}", self.api_key))
            .json(&body)
            .send()
            .await
            .map_err(|err| {
                CadenzaError::AssistantErr(format!("request to openai failed: {err}"))
            })?;

        // checked before the body, since a 429 has no output to parse
        if resp.status() == StatusCode::TOO_MANY_REQUESTS {
            return Err(CadenzaError::AssistantRateLimited {
                retry_after: rate_limit_wait(resp.headers()),
            });
        }

        let status = resp.status();
        let parsed: ResponsesApiResponse = resp.json().await.map_err(|err| {
            CadenzaError::AssistantErr(format!("openai returned a malformed response: {err}"))
        })?;
        if let Some(error) = parsed.error {
            return Err(CadenzaError::AssistantErr(error.message));
        }
        if !status.is_success() {
            return Err(CadenzaError::AssistantErr(format!(
                "openai returned status {status}"
            )));
        }
        Ok(parsed.into_turn())
    }
}

// the parts of a Responses API response the assistant reads
// https://developers.openai.com/api/reference/resources/responses/methods/create
#[derive(Deserialize)]
struct ResponsesApiResponse {
    #[serde(default)]
    error: Option<ResponseError>,
    #[serde(default)]
    output: Vec<OutputItem>,
}

#[derive(Deserialize)]
struct ResponseError {
    message: String,
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum OutputItem {
    Message {
        #[serde(default)]
        content: Vec<OutputContent>,
    },
    FunctionCall {
        call_id: String,
        name: String,
        arguments: String,
    },
    /// Reasoning and anything else the assistant does not read.
    #[serde(other)]
    Other,
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum OutputContent {
    OutputText {
        text: String,
    },
    #[serde(other)]
    Other,
}

impl ResponsesApiResponse {
    fn into_turn(self) -> ModelTurn {
        let mut text = String::new();
        let mut calls = Vec::new();
        for item in self.output {
            match item {
                OutputItem::Message { content } => {
                    for part in content {
                        if let OutputContent::OutputText { text: part } = part {
                            text.push_str(&part);
                        }
                    }
                }
                OutputItem::FunctionCall {
                    call_id,
                    name,
                    arguments,
                } => calls.push(FunctionCall {
                    call_id,
                    name,
                    arguments,
                }),
                OutputItem::Other => {}
            }
        }
        let text = text.trim();
        ModelTurn {
            text: (!text.is_empty()).then(|| text.to_owned()),
            calls,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_text_and_tool_calls_out_of_a_response() {
        let response: ResponsesApiResponse = serde_json::from_value(json!({
            "output": [
                { "type": "reasoning", "id": "rs_1", "summary": [] },
                {
                    "type": "function_call",
                    "id": "fc_1",
                    "call_id": "call_1",
                    "name": "list_tags",
                    "arguments": "{}"
                },
                {
                    "type": "message",
                    "role": "assistant",
                    "content": [
                        { "type": "output_text", "text": "You have ", "annotations": [] },
                        { "type": "output_text", "text": "3 tags.", "annotations": [] }
                    ]
                }
            ]
        }))
        .unwrap();

        assert_eq!(
            response.into_turn(),
            ModelTurn {
                text: Some("You have 3 tags.".into()),
                calls: vec![FunctionCall {
                    call_id: "call_1".into(),
                    name: "list_tags".into(),
                    arguments: "{}".into(),
                }],
            }
        );
    }

    #[test]
    fn blank_text_counts_as_none() {
        let response: ResponsesApiResponse = serde_json::from_value(json!({
            "output": [{ "type": "message", "content": [{ "type": "output_text", "text": "  " }] }]
        }))
        .unwrap();
        assert_eq!(response.into_turn().text, None);
    }
}
