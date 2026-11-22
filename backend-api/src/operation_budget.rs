//! Response deadlines leave margin below the 60-second CloudFront origin timeout.
use crate::err::CadenzaError;
use axum::{
    extract::Request,
    middleware::Next,
    response::{IntoResponse, Response},
};
use std::{future::Future, time::Duration};

pub const REQUEST_BUDGET: Duration = Duration::from_secs(50);

pub async fn within<F: Future>(budget: Duration, future: F) -> Result<F::Output, CadenzaError> {
    tokio::time::timeout(budget, future)
        .await
        .map_err(|_| CadenzaError::OperationTimeout)
}

pub async fn limit_request(request: Request, next: Next) -> Response {
    respond_within(REQUEST_BUDGET, request, next).await
}

async fn respond_within(budget: Duration, request: Request, next: Next) -> Response {
    match within(budget, next.run(request)).await {
        Ok(response) => response,
        Err(error) => error.into_response(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    };

    struct OnDrop(Arc<AtomicBool>);
    impl Drop for OnDrop {
        fn drop(&mut self) {
            self.0.store(true, Ordering::SeqCst);
        }
    }

    #[tokio::test]
    async fn budget_cancels_slow_work_and_returns_generic_504() {
        let dropped = Arc::new(AtomicBool::new(false));
        let guard = OnDrop(dropped.clone());
        let result = within(Duration::from_millis(10), async move {
            let _guard = guard;
            std::future::pending::<()>().await;
        })
        .await;
        let response = result.unwrap_err().into_response();
        assert_eq!(response.status(), 504);
        assert!(dropped.load(Ordering::SeqCst));
        let body = axum::body::to_bytes(response.into_body(), 2048)
            .await
            .unwrap();
        let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(json["error_type"], "OperationTimeout");
    }

    #[tokio::test]
    async fn budget_covers_sequential_calls_together() {
        let stages = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let count = stages.clone();
        assert!(
            within(Duration::from_millis(35), async move {
                for _ in 0..5 {
                    tokio::time::sleep(Duration::from_millis(20)).await;
                    count.fetch_add(1, Ordering::SeqCst);
                }
            })
            .await
            .is_err()
        );
        assert!(stages.load(Ordering::SeqCst) < 5);
        assert_eq!(
            within(Duration::from_secs(1), async { 42 }).await.unwrap(),
            42
        );
    }
    #[tokio::test]
    async fn budget_http_returns_504_for_slow_handler_and_200_for_fast_handler() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let app = axum::Router::new()
            .route(
                "/slow",
                axum::routing::get(|| async {
                    tokio::time::sleep(Duration::from_secs(5)).await;
                    "too late"
                }),
            )
            .route("/fast", axum::routing::get(|| async { "ok" }))
            .layer(axum::middleware::from_fn(|request, next| {
                respond_within(Duration::from_millis(30), request, next)
            }));
        let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(2))
            .build()
            .unwrap();
        let slow = client.get(format!("http://{addr}/slow")).send().await;
        let fast = client.get(format!("http://{addr}/fast")).send().await;
        server.abort();
        let slow = slow.unwrap();
        assert_eq!(slow.status(), 504);
        assert_eq!(
            slow.json::<serde_json::Value>().await.unwrap()["error_type"],
            "OperationTimeout"
        );
        let fast = fast.unwrap();
        assert_eq!(fast.status(), 200);
        assert_eq!(fast.text().await.unwrap(), "ok");
    }
}
