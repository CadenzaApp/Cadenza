use std::{env, time::Duration};

use dotenvy::dotenv;
use reqwest::{Client, Method, Response};
use serde_json::{Map, Value};

use crate::err::CadenzaError;

const DEFAULT_SOCIAL_SERVICE_URL: &str = "http://localhost:3001";
const SOCIAL_SERVICE_HTTP_TIMEOUT_SECS: u64 = 10;

/// Forwards requests to the social feed service, stamping them with the caller's user id.
///
/// The service has no auth of its own and takes the user id as data: on a GET it reads
/// `user_id` from the query string, on anything else from the JSON body. So the user id has
/// to come from the verified claims here and never from what the client sent.
#[derive(Clone)]
pub struct SocialFeedService {
    base_url: String,
    http_client: Client,
}

impl SocialFeedService {
    /// Reads `SOCIAL_FEED_URL`, defaulting to `DEFAULT_SOCIAL_SERVICE_URL`. A trailing slash
    /// is trimmed so path joining never doubles it.
    pub fn new() -> Self {
        dotenv().ok();

        let base_url =
            env::var("SOCIAL_FEED_URL").unwrap_or_else(|_| DEFAULT_SOCIAL_SERVICE_URL.to_owned());

        Self {
            base_url: base_url.trim_end_matches('/').to_owned(),
            http_client: Client::builder()
                .timeout(Duration::from_secs(SOCIAL_SERVICE_HTTP_TIMEOUT_SECS))
                .build()
                .expect("failed to build http client for SocialFeedService"),
        }
    }

    /// Sends `method path?query` to the service with `user_id` added, and hands back the
    /// upstream response for the caller to relay.
    ///
    /// `body` is only read for methods other than GET, where it must be a JSON object or
    /// absent. A GET carries the user id in the query string instead.
    pub async fn forward(
        &self,
        method: Method,
        path: &str,
        query: Option<&str>,
        body: Option<Value>,
        user_id: &str,
    ) -> Result<Response, CadenzaError> {
        let url = build_url(&self.base_url, path, query, &method, user_id);

        let mut req = self.http_client.request(method.clone(), url);
        if method != Method::GET {
            req = req.json(&with_user_id(body, user_id)?);
        }

        req.send()
            .await
            .map_err(|err| CadenzaError::SocialFeedErr(err.to_string()))
    }
}

/// `base/path`, with the original query string kept and `user_id` appended for a GET.
fn build_url(
    base_url: &str,
    path: &str,
    query: Option<&str>,
    method: &Method,
    user_id: &str,
) -> String {
    let mut url = format!("{base_url}/{}", path.trim_start_matches('/'));

    if let Some(query) = query.filter(|query| !query.is_empty()) {
        url.push('?');
        url.push_str(query);
    }

    if *method == Method::GET {
        url.push(if url.contains('?') { '&' } else { '?' });
        url.push_str("user_id=");
        url.push_str(user_id);
    }

    url
}

/// The request body with `user_id` set on it, from an empty body if there was none.
///
/// The service reads the id off the top level of the body, so anything that is not a JSON
/// object has nowhere to put it and is rejected rather than silently replaced.
fn with_user_id(body: Option<Value>, user_id: &str) -> Result<Value, CadenzaError> {
    let mut object = match body {
        None | Some(Value::Null) => Map::new(),
        Some(Value::Object(object)) => object,
        Some(_) => {
            return Err(CadenzaError::InvalidRequestBody(
                "request body must be a json object".to_owned(),
            ));
        }
    };

    object.insert("user_id".to_owned(), Value::String(user_id.to_owned()));

    Ok(Value::Object(object))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    const USER: &str = "11111111-1111-1111-1111-111111111111";

    #[test]
    fn get_url_carries_the_user_id_in_the_query_string() {
        assert_eq!(
            build_url("http://host:3001", "feed", None, &Method::GET, USER),
            format!("http://host:3001/feed?user_id={USER}")
        );
    }

    #[test]
    fn get_url_keeps_the_original_query_and_appends_the_user_id() {
        assert_eq!(
            build_url(
                "http://host:3001",
                "feed",
                Some("limit=5"),
                &Method::GET,
                USER
            ),
            format!("http://host:3001/feed?limit=5&user_id={USER}")
        );
    }

    #[test]
    fn non_get_url_leaves_the_user_id_out_of_the_query_string() {
        assert_eq!(
            build_url(
                "http://host:3001",
                "interests/decay",
                None,
                &Method::PATCH,
                USER
            ),
            "http://host:3001/interests/decay".to_string()
        );
    }

    #[test]
    fn url_joining_never_doubles_the_separating_slash() {
        assert_eq!(
            build_url("http://host:3001", "/feed", None, &Method::PATCH, USER),
            "http://host:3001/feed".to_string()
        );
    }

    #[test]
    fn empty_query_doesnt_leave_a_bare_question_mark() {
        assert_eq!(
            build_url("http://host:3001", "feed", Some(""), &Method::PATCH, USER),
            "http://host:3001/feed".to_string()
        );
    }

    #[test]
    fn missing_body_becomes_an_object_holding_only_the_user_id() {
        assert_eq!(
            with_user_id(None, USER).unwrap(),
            json!({ "user_id": USER })
        );
    }

    #[test]
    fn body_keeps_its_own_fields_alongside_the_user_id() {
        assert_eq!(
            with_user_id(Some(json!({ "song_id": "123" })), USER).unwrap(),
            json!({ "song_id": "123", "user_id": USER })
        );
    }

    #[test]
    fn body_cannot_pass_its_own_user_id() {
        assert_eq!(
            with_user_id(Some(json!({ "user_id": "somebody-else" })), USER).unwrap(),
            json!({ "user_id": USER })
        );
    }

    #[test]
    fn non_object_body_is_rejected() {
        assert!(matches!(
            with_user_id(Some(json!([1, 2, 3])), USER),
            Err(CadenzaError::InvalidRequestBody(_))
        ));
    }
}
