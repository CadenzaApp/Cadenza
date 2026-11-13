//! Local health and bounded shutdown. No database or provider health probes.

use std::future::Future;
use std::time::Duration;
use std::{io, net::SocketAddr, pin::Pin};

use axum::{
    Json, Router,
    extract::{Request, State},
    http::StatusCode,
    middleware::Next,
    response::{IntoResponse, Response},
    routing::get,
};
use serde_json::json;
use tokio::task::JoinHandle;
use tokio_util::{sync::CancellationToken, task::TaskTracker};

use crate::err::CadenzaError;

pub const SHUTDOWN_GRACE: Duration = Duration::from_secs(120);
pub const SHUTDOWN_CLEANUP: Duration = Duration::from_secs(15);

/// Shared by background services and the HTTP shutdown coordinator.
/// Accepted requests may still spawn follow-up work while HTTP drains.
#[derive(Clone, Default)]
pub struct BackgroundTasks {
    stopping: CancellationToken,
    force: CancellationToken,
    tasks: TaskTracker,
}

impl BackgroundTasks {
    pub fn begin_shutdown(&self) {
        self.stopping.cancel();
    }

    pub fn is_stopping(&self) -> bool {
        self.stopping.is_cancelled()
    }

    pub async fn cancelled(&self) {
        self.stopping.cancelled().await;
    }

    /// False when shutdown interrupts an idle/backoff wait.
    pub async fn pause(&self, duration: Duration) -> bool {
        tokio::select! {
            biased;
            _ = self.cancelled() => false,
            _ = tokio::time::sleep(duration) => true,
        }
    }

    /// Track detached work even if its requesting HTTP client disconnects.
    /// None means the shutdown deadline forced cancellation.
    pub fn spawn<F>(&self, future: F) -> JoinHandle<Option<F::Output>>
    where
        F: Future + Send + 'static,
        F::Output: Send + 'static,
    {
        let force = self.force.clone();
        self.tasks.spawn(async move {
            tokio::select! {
                biased;
                _ = force.cancelled() => None,
                output = future => Some(output),
            }
        })
    }

    /// Call after HTTP has drained so no untracked request can enqueue work.
    pub async fn finish(&self, deadline: tokio::time::Instant) -> bool {
        self.tasks.close();
        if tokio::time::timeout_at(deadline, self.tasks.wait())
            .await
            .is_ok()
        {
            true
        } else {
            self.force.cancel();
            false
        }
    }

    pub async fn wait_for_cancelled_tasks(&self) {
        self.tasks.wait().await;
    }
}

/// Reject new operations on already-open connections once draining begins.
pub async fn reject_while_draining(
    State(tasks): State<BackgroundTasks>,
    request: Request,
    next: Next,
) -> Response {
    if tasks.is_stopping() {
        CadenzaError::ServiceUnavailable.into_response()
    } else {
        next.run(request).await
    }
}

pub fn health_router(tasks: BackgroundTasks, model_url: &str) -> Router {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(2))
        .connect_timeout(Duration::from_secs(1))
        .build()
        .expect("failed to build local readiness client");
    let ready_url = format!("{}/health/ready", model_url.trim_end_matches('/'));
    Router::new()
        .route(
            "/health/live",
            get(|| async { Json(json!({"status": "alive"})) }),
        )
        .route(
            "/health/ready",
            get(move || {
                let (tasks, client, ready_url) = (tasks.clone(), client.clone(), ready_url.clone());
                async move {
                    if tasks.is_stopping() {
                        return (
                            StatusCode::SERVICE_UNAVAILABLE,
                            Json(json!({"status": "draining"})),
                        );
                    }
                    let ready = match client.get(ready_url).send().await {
                        Ok(response) if response.status().is_success() => response
                            .json::<serde_json::Value>()
                            .await
                            .is_ok_and(|body| {
                                body.get("status").and_then(|s| s.as_str()) == Some("ready")
                            }),
                        _ => false,
                    };
                    if tasks.is_stopping() {
                        (
                            StatusCode::SERVICE_UNAVAILABLE,
                            Json(json!({"status": "draining"})),
                        )
                    } else if ready {
                        (StatusCode::OK, Json(json!({"status": "ready"})))
                    } else {
                        (
                            StatusCode::SERVICE_UNAVAILABLE,
                            Json(json!({"status": "model_unavailable"})),
                        )
                    }
                }
            }),
        )
}

pub async fn shutdown_signal() {
    #[cfg(unix)]
    {
        let mut terminate =
            tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
                .expect("failed to install SIGTERM handler");
        tokio::select! {
            result = tokio::signal::ctrl_c() => result.expect("failed to receive Ctrl-C"),
            _ = terminate.recv() => {},
        }
    }
    #[cfg(not(unix))]
    tokio::signal::ctrl_c()
        .await
        .expect("failed to receive Ctrl-C");
}

/// Stop accepting connections, finish existing HTTP and tracked work against
/// one shared deadline, then cancel work that outlived that deadline.
pub async fn drain_server<F>(
    mut server: Pin<&mut F>,
    handle: axum_server::Handle<SocketAddr>,
    tasks: &BackgroundTasks,
    grace: Duration,
) -> io::Result<()>
where
    F: Future<Output = io::Result<()>>,
{
    tasks.begin_shutdown();
    let deadline = tokio::time::Instant::now() + grace;
    handle.graceful_shutdown(Some(grace));
    let result = match tokio::time::timeout_at(deadline, server.as_mut()).await {
        Ok(result) => result,
        Err(_) => {
            handle.shutdown();
            eprintln!("[shutdown] HTTP drain deadline reached; closing remaining connections");
            Ok(())
        }
    };
    if !tasks.finish(deadline).await {
        eprintln!("[shutdown] work deadline reached; cancelling unfinished tasks");
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{
        Arc,
        atomic::{AtomicU8, Ordering},
    };
    use tokio::sync::Notify;

    struct TestServer {
        url: String,
        task: JoinHandle<()>,
    }

    impl Drop for TestServer {
        fn drop(&mut self) {
            self.task.abort();
        }
    }

    async fn serve(app: Router) -> TestServer {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        let task = tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });
        TestServer { url, task }
    }

    #[tokio::test]
    async fn lifecycle_readiness_requires_model_acknowledgement_and_liveness_is_independent() {
        let state = Arc::new(AtomicU8::new(0));
        let stub = state.clone();
        let model = serve(Router::new().route(
            "/health/ready",
            get(move || {
                let stub = stub.clone();
                async move {
                    match stub.load(Ordering::SeqCst) {
                        0 => (StatusCode::OK, "{\"status\":\"loading\"}"),
                        1 => (StatusCode::OK, "{\"status\":\"ready\"}"),
                        _ => (
                            StatusCode::SERVICE_UNAVAILABLE,
                            "private diagnostic details",
                        ),
                    }
                }
            }),
        ))
        .await;
        let api = serve(health_router(BackgroundTasks::default(), &model.url)).await;
        let client = reqwest::Client::new();
        for (value, expected) in [(0, 503), (1, 200), (2, 503)] {
            state.store(value, Ordering::SeqCst);
            let response = client
                .get(format!("{}/health/ready", api.url))
                .send()
                .await
                .unwrap();
            assert_eq!(response.status().as_u16(), expected);
            assert!(
                !response
                    .text()
                    .await
                    .unwrap()
                    .contains("private diagnostic")
            );
            assert_eq!(
                client
                    .get(format!("{}/health/live", api.url))
                    .send()
                    .await
                    .unwrap()
                    .status(),
                StatusCode::OK
            );
        }
        drop(model);
        assert_eq!(
            client
                .get(format!("{}/health/ready", api.url))
                .send()
                .await
                .unwrap()
                .status(),
            StatusCode::SERVICE_UNAVAILABLE
        );
    }

    #[tokio::test]
    async fn lifecycle_drain_rejects_new_work_without_interrupting_an_accepted_request() {
        let tasks = BackgroundTasks::default();
        let entered = Arc::new(Notify::new());
        let released = Arc::new(Notify::new());
        let (started, finish) = (entered.clone(), released.clone());
        let app = Router::new()
            .route(
                "/operation",
                get(move || {
                    let (started, finish) = (started.clone(), finish.clone());
                    async move {
                        started.notify_one();
                        finish.notified().await;
                        "finished"
                    }
                }),
            )
            .layer(axum::middleware::from_fn_with_state(
                tasks.clone(),
                reject_while_draining,
            ))
            .merge(health_router(tasks.clone(), "http://127.0.0.1:1"));
        let api = serve(app).await;
        let url = format!("{}/operation", api.url);
        let old = tokio::spawn(async move { reqwest::get(url).await.unwrap() });
        tokio::time::timeout(Duration::from_secs(2), entered.notified())
            .await
            .unwrap();
        tasks.begin_shutdown();
        assert_eq!(
            reqwest::get(format!("{}/operation", api.url))
                .await
                .unwrap()
                .status(),
            StatusCode::SERVICE_UNAVAILABLE
        );
        assert_eq!(
            reqwest::get(format!("{}/health/ready", api.url))
                .await
                .unwrap()
                .status(),
            StatusCode::SERVICE_UNAVAILABLE
        );
        assert_eq!(
            reqwest::get(format!("{}/health/live", api.url))
                .await
                .unwrap()
                .status(),
            StatusCode::OK
        );
        assert!(!old.is_finished());
        released.notify_one();
        assert_eq!(old.await.unwrap().text().await.unwrap(), "finished");
    }

    #[tokio::test]
    async fn lifecycle_waits_for_follow_up_work_spawned_by_an_accepted_request() {
        let tasks = BackgroundTasks::default();
        tasks.begin_shutdown();
        let (release, wait) = tokio::sync::oneshot::channel();
        let work = tasks.spawn(async move {
            wait.await.unwrap();
            42
        });
        let watcher = tasks.clone();
        let finish = tokio::spawn(async move {
            watcher
                .finish(tokio::time::Instant::now() + Duration::from_secs(2))
                .await
        });
        tokio::task::yield_now().await;
        assert!(!finish.is_finished());
        release.send(()).unwrap();
        assert!(finish.await.unwrap());
        assert_eq!(work.await.unwrap(), Some(42));
    }

    #[tokio::test]
    async fn lifecycle_deadline_cancels_stuck_work_and_idle_waits_are_interruptible() {
        let tasks = BackgroundTasks::default();
        let work = tasks.spawn(std::future::pending::<()>());
        tasks.begin_shutdown();
        assert!(!tasks.pause(Duration::from_secs(100)).await);
        assert!(
            !tasks
                .finish(tokio::time::Instant::now() + Duration::from_millis(10))
                .await
        );
        tokio::time::timeout(Duration::from_secs(2), tasks.wait_for_cancelled_tasks())
            .await
            .unwrap();
        assert!(work.await.unwrap().is_none());
    }

    #[tokio::test]
    async fn lifecycle_server_drain_waits_for_http_then_detached_work() {
        let tasks = BackgroundTasks::default();
        let entered = Arc::new(Notify::new());
        let finish = Arc::new(Notify::new());
        let (notify, release) = (entered.clone(), finish.clone());
        let app = Router::new().route(
            "/",
            get(move || {
                let (notify, release) = (notify.clone(), release.clone());
                async move {
                    notify.notify_one();
                    release.notified().await;
                    "completed"
                }
            }),
        );
        let handle = axum_server::Handle::new();
        let waiter = handle.clone();
        let (stop, stopped) = tokio::sync::oneshot::channel::<()>();
        let worker = tasks.clone();
        let server = tokio::spawn(async move {
            let future = axum_server::bind("127.0.0.1:0".parse().unwrap())
                .handle(handle.clone())
                .serve(app.into_make_service());
            tokio::pin!(future);
            tokio::select! {
                r = &mut future => r,
                _ = stopped => drain_server(future.as_mut(), handle, &worker, Duration::from_secs(2)).await,
            }
        });
        let addr = waiter.listening().await.unwrap();
        let request = tokio::spawn(async move {
            reqwest::get(format!("http://{addr}/"))
                .await
                .unwrap()
                .text()
                .await
                .unwrap()
        });
        tokio::time::timeout(Duration::from_secs(2), entered.notified())
            .await
            .unwrap();
        let (finish_work, work_wait) = tokio::sync::oneshot::channel();
        tasks.spawn(async move {
            let _ = work_wait.await;
        });
        stop.send(()).unwrap();
        tasks.cancelled().await;
        assert!(!server.is_finished());
        finish.notify_one();
        assert_eq!(request.await.unwrap(), "completed");
        assert!(!server.is_finished());
        finish_work.send(()).unwrap();
        tokio::time::timeout(Duration::from_secs(2), server)
            .await
            .unwrap()
            .unwrap()
            .unwrap();
    }

    #[tokio::test]
    async fn lifecycle_server_deadline_closes_a_stuck_request_and_cancels_work() {
        let tasks = BackgroundTasks::default();
        let entered = Arc::new(Notify::new());
        let notify = entered.clone();
        let app = Router::new().route(
            "/",
            get(move || {
                let notify = notify.clone();
                async move {
                    notify.notify_one();
                    std::future::pending::<&'static str>().await
                }
            }),
        );
        let work = tasks.spawn(std::future::pending::<()>());
        let handle = axum_server::Handle::new();
        let waiter = handle.clone();
        let (stop, stopped) = tokio::sync::oneshot::channel::<()>();
        let worker = tasks.clone();
        let server = tokio::spawn(async move {
            let future = axum_server::bind("127.0.0.1:0".parse().unwrap())
                .handle(handle.clone())
                .serve(app.into_make_service());
            tokio::pin!(future);
            tokio::select! {
                r = &mut future => r,
                _ = stopped => drain_server(future.as_mut(), handle, &worker, Duration::from_millis(30)).await,
            }
        });
        let addr = waiter.listening().await.unwrap();
        let request = tokio::spawn(async move { reqwest::get(format!("http://{addr}/")).await });
        tokio::time::timeout(Duration::from_secs(2), entered.notified())
            .await
            .unwrap();
        stop.send(()).unwrap();
        tokio::time::timeout(Duration::from_secs(2), server)
            .await
            .unwrap()
            .unwrap()
            .unwrap();
        tokio::time::timeout(Duration::from_secs(2), tasks.wait_for_cancelled_tasks())
            .await
            .unwrap();
        assert!(work.await.unwrap().is_none());
        assert!(
            tokio::time::timeout(Duration::from_secs(2), request)
                .await
                .unwrap()
                .unwrap()
                .is_err()
        );
    }
}
