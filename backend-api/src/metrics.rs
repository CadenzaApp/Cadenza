//! Private Prometheus metrics. Labels contain route templates, never request data.
use std::{
    sync::{Arc, OnceLock},
    time::Instant,
};

use axum::{
    Router,
    extract::{MatchedPath, Request, State},
    middleware::Next,
    response::Response,
    routing::get,
};
use prometheus::{
    Encoder, HistogramOpts, HistogramVec, IntCounter, IntCounterVec, IntGauge, IntGaugeVec, Opts,
    Registry, TextEncoder,
};

pub struct Metrics {
    registry: Registry,
    duration: HistogramVec,
    requests: IntCounterVec,
    in_flight: IntGauge,
    pub refusals: IntCounterVec,
    pub provider_calls: IntCounter,
    limits: IntGaugeVec,
    provider_used: IntGauge,
    provider_active: IntGauge,
    provider_window_remaining: IntGauge,
}

impl Metrics {
    fn new() -> Self {
        let registry = Registry::new();
        let duration = HistogramVec::new(HistogramOpts::new("cadenza_http_request_duration_seconds", "Time until response headers, including auth, queueing and handler work; cancelled requests are separate outcomes.")
            .const_labels([("histogram_schema".to_owned(), "2".to_owned())].into())
            .buckets(vec![0.001, 0.0025, 0.005, 0.01, 0.02, 0.035, 0.05, 0.1, 0.25, 0.4, 0.6, 0.8, 1.0, 2.5, 5.0, 10.0, 20.0, 30.0, 40.0, 50.0, 60.0]), &["method", "route", "status"]).unwrap();
        let requests = IntCounterVec::new(
            Opts::new(
                "cadenza_http_requests_total",
                "Completed or cancelled HTTP requests.",
            ),
            &["method", "route", "status"],
        )
        .unwrap();
        let in_flight = IntGauge::new(
            "cadenza_http_requests_in_flight",
            "HTTP requests currently being handled.",
        )
        .unwrap();
        let refusals = IntCounterVec::new(
            Opts::new(
                "cadenza_admission_refusals_total",
                "Requests or provider calls refused by local admission controls.",
            ),
            &["scope"],
        )
        .unwrap();
        for scope in [
            "request_or_tag_quota",
            "http_capacity",
            "provider_concurrency",
            "provider_day_quota",
        ] {
            refusals.with_label_values(&[scope]);
        }
        let provider_calls = IntCounter::new(
            "cadenza_provider_calls_total",
            "Admitted tag provider call attempts, including background work and failures.",
        )
        .unwrap();
        let limits = IntGaugeVec::new(
            Opts::new(
                "cadenza_configured_limit",
                "Effective process-local admission settings.",
            ),
            &["limit"],
        )
        .unwrap();
        let provider_used = IntGauge::new(
            "cadenza_provider_window_calls",
            "Provider calls charged to the current rolling daily budget; zero after expiry.",
        )
        .unwrap();
        let provider_active = IntGauge::new(
            "cadenza_provider_calls_in_flight",
            "Held provider-call permits.",
        )
        .unwrap();
        let provider_window_remaining = IntGauge::new(
            "cadenza_provider_window_remaining_seconds",
            "Seconds before the current provider budget expires; zero when idle/expired.",
        )
        .unwrap();
        for collector in [
            Box::new(duration.clone()) as Box<dyn prometheus::core::Collector>,
            Box::new(requests.clone()),
            Box::new(in_flight.clone()),
            Box::new(refusals.clone()),
            Box::new(provider_calls.clone()),
            Box::new(limits.clone()),
            Box::new(provider_used.clone()),
            Box::new(provider_active.clone()),
            Box::new(provider_window_remaining.clone()),
        ] {
            registry.register(collector).unwrap();
        }
        Self {
            registry,
            duration,
            requests,
            in_flight,
            refusals,
            provider_calls,
            limits,
            provider_used,
            provider_active,
            provider_window_remaining,
        }
    }

    fn render(&self) -> Vec<u8> {
        let snapshot = crate::admission::metrics_snapshot();
        for (name, value) in snapshot.limits {
            self.limits.with_label_values(&[name]).set(value as i64);
        }
        self.provider_used.set(snapshot.provider_used as i64);
        self.provider_active.set(snapshot.provider_active as i64);
        self.provider_window_remaining
            .set(snapshot.provider_window_remaining as i64);
        let mut buffer = Vec::new();
        TextEncoder::new()
            .encode(&self.registry.gather(), &mut buffer)
            .expect("encode metrics");
        buffer
    }
}

pub fn global() -> &'static Arc<Metrics> {
    static METRICS: OnceLock<Arc<Metrics>> = OnceLock::new();
    METRICS.get_or_init(|| Arc::new(Metrics::new()))
}

struct Observation {
    metrics: Arc<Metrics>,
    method: &'static str,
    route: String,
    started: Instant,
    status: String,
}

impl Drop for Observation {
    fn drop(&mut self) {
        let labels = [self.method, self.route.as_str(), self.status.as_str()];
        self.metrics.requests.with_label_values(&labels).inc();
        self.metrics
            .duration
            .with_label_values(&labels)
            .observe(self.started.elapsed().as_secs_f64());
        self.metrics.in_flight.dec();
    }
}

pub async fn track(State(metrics): State<Arc<Metrics>>, request: Request, next: Next) -> Response {
    // Unknown methods and unmatched paths each use one bounded label value.
    let method = match request.method().as_str() {
        "GET" => "GET",
        "POST" => "POST",
        "PUT" => "PUT",
        "PATCH" => "PATCH",
        "DELETE" => "DELETE",
        "HEAD" => "HEAD",
        "OPTIONS" => "OPTIONS",
        _ => "OTHER",
    };
    let route = request
        .extensions()
        .get::<MatchedPath>()
        .map(|path| path.as_str())
        .unwrap_or("unmatched")
        .to_owned();
    metrics.in_flight.inc();
    let mut observation = Observation {
        metrics,
        method,
        route,
        started: Instant::now(),
        status: "cancelled".to_owned(),
    };
    let response = next.run(request).await;
    observation.status = response.status().as_u16().to_string();
    response
}

/// Only this router has /metrics. The public API router never mounts it.
pub fn router(metrics: Arc<Metrics>) -> Router {
    Router::new()
        .route(
            "/metrics",
            get(|State(metrics): State<Arc<Metrics>>| async move {
                (
                    [(
                        axum::http::header::CONTENT_TYPE,
                        "text/plain; version=0.0.4; charset=utf-8",
                    )],
                    metrics.render(),
                )
            }),
        )
        .with_state(metrics)
}

/// Disabled unless explicitly configured. Docker exposes this only internally.
pub async fn start() -> std::io::Result<Option<tokio::task::JoinHandle<()>>> {
    let Ok(address) = std::env::var("METRICS_BIND_ADDR") else {
        return Ok(None);
    };
    let listener = tokio::net::TcpListener::bind(&address).await?;
    let app = router(global().clone());
    Ok(Some(tokio::spawn(async move {
        if let Err(error) = axum::serve(listener, app).await {
            eprintln!("metrics listener failed: {error}");
        }
    })))
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn serve(app: Router) -> (String, tokio::task::JoinHandle<()>) {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let task = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        (format!("http://{address}"), task)
    }

    #[tokio::test]
    async fn nested_routes_are_bounded_and_scrapes_stay_off_the_public_router() {
        let metrics = Arc::new(Metrics::new());
        let api = Router::new()
            .nest(
                "/tags",
                Router::new().route("/{id}", get(|| async { "private body" })),
            )
            .route(
                "/denied",
                get(|| async { axum::http::StatusCode::UNAUTHORIZED }),
            )
            .layer(axum::middleware::from_fn_with_state(metrics.clone(), track));
        let (base, task) = serve(api).await;
        let (scrapes, scrape_task) = serve(router(metrics.clone())).await;
        let client = reqwest::Client::new();
        for id in ["secret-id-one", "secret-id-two"] {
            assert_eq!(
                client
                    .get(format!("{base}/tags/{id}?token=do-not-record"))
                    .send()
                    .await
                    .unwrap()
                    .status(),
                200
            );
        }
        for index in 0..20 {
            assert_eq!(
                client
                    .get(format!("{base}/unknown-{index}"))
                    .send()
                    .await
                    .unwrap()
                    .status(),
                404
            );
        }
        assert_eq!(
            client
                .request(
                    reqwest::Method::from_bytes(b"BREW").unwrap(),
                    format!("{base}/tags/secret-id-three")
                )
                .send()
                .await
                .unwrap()
                .status(),
            405
        );
        assert_eq!(
            client
                .get(format!("{base}/denied"))
                .send()
                .await
                .unwrap()
                .status(),
            401
        );
        assert_eq!(
            client
                .get(format!("{base}/metrics"))
                .send()
                .await
                .unwrap()
                .status(),
            404
        );
        let response = client
            .get(format!("{scrapes}/metrics"))
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), 200);
        assert!(
            response.headers()["content-type"]
                .to_str()
                .unwrap()
                .contains("text/plain")
        );
        let text = response.text().await.unwrap();
        assert!(text.contains("route=\"/tags/{id}\""), "{text}");
        assert!(text.contains("status=\"401\""));
        assert!(text.contains("cadenza_http_request_duration_seconds_bucket"));
        assert!(text.contains("cadenza_http_requests_in_flight 0"));
        assert_eq!(
            metrics
                .requests
                .with_label_values(&["GET", "/tags/{id}", "200"])
                .get(),
            2
        );
        assert_eq!(
            metrics
                .requests
                .with_label_values(&["GET", "unmatched", "404"])
                .get(),
            21
        );
        for secret in [
            "secret-id",
            "do-not-record",
            "private body",
            "unknown-19",
            "BREW",
        ] {
            assert!(!text.contains(secret));
        }
        task.abort();
        scrape_task.abort();
    }

    #[test]
    fn detailed_buckets_count_fast_requests_and_keep_slow_tail_precision() {
        let metrics = Metrics::new();
        let histogram = metrics
            .duration
            .with_label_values(&["GET", "/example", "200"]);
        histogram.observe(0.019);
        histogram.observe(0.375);
        histogram.observe(12.0);
        let text = String::from_utf8(metrics.render()).unwrap();
        for (boundary, count) in [
            ("0.01", "0"),
            ("0.02", "1"),
            ("0.25", "1"),
            ("0.4", "2"),
            ("10", "2"),
            ("20", "3"),
            ("+Inf", "3"),
        ] {
            let line = text
                .lines()
                .find(|line| {
                    line.starts_with("cadenza_http_request_duration_seconds_bucket{")
                        && line.contains(&format!("le=\"{boundary}\""))
                })
                .unwrap();
            assert!(line.contains("histogram_schema=\"2\""));
            assert!(line.ends_with(&format!(" {count}")), "{line}");
        }
    }

    #[test]
    fn cancelled_observations_release_the_gauge_and_do_not_count_as_success() {
        let metrics = Arc::new(Metrics::new());
        metrics.in_flight.inc();
        drop(Observation {
            metrics: metrics.clone(),
            method: "GET",
            route: "/cancelled".into(),
            started: Instant::now(),
            status: "cancelled".into(),
        });
        assert_eq!(metrics.in_flight.get(), 0);
        assert_eq!(
            metrics
                .requests
                .with_label_values(&["GET", "/cancelled", "cancelled"])
                .get(),
            1
        );
        assert_eq!(
            metrics
                .duration
                .with_label_values(&["GET", "/cancelled", "cancelled"])
                .get_sample_count(),
            1
        );
    }
}
