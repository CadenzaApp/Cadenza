use std::time::Instant;

use axum::{
    extract::{MatchedPath, Request, State},
    http::{StatusCode, header},
    middleware::Next,
    response::{IntoResponse, Response},
};
use opentelemetry::{
    KeyValue,
    metrics::{Counter, Histogram, MeterProvider as _},
};
use opentelemetry_sdk::metrics::{Aggregation, Instrument, SdkMeterProvider, Stream};
use prometheus::{Encoder, Registry, TextEncoder};

#[derive(Clone)]
pub struct Metrics {
    registry: Registry,

    _provider: SdkMeterProvider,

    request_count: Counter<u64>,
    request_duration: Histogram<f64>,
}

impl Metrics {
    pub fn new() -> Self {
        let registry = Registry::new();

        let exporter = opentelemetry_prometheus::exporter()
            .with_registry(registry.clone())
            .build()
            .expect("failed to build Prometheus metrics exporter");

        let request_duration_view = |instrument: &Instrument| {
            if instrument.name() == "cadenza_http_request_duration_seconds" {
                Stream::builder()
                    .with_aggregation(Aggregation::ExplicitBucketHistogram {
                        boundaries: vec![
                            0.010, 0.050, 0.100, 0.200, 0.230, 0.250, 0.270, 0.300, 0.400, 0.450,
                            10.00,
                        ],
                        record_min_max: false,
                    })
                    .build()
                    .ok()
            } else {
                None
            }
        };

        let provider = SdkMeterProvider::builder()
            .with_reader(exporter)
            .with_view(request_duration_view)
            .build();

        let meter = provider.meter("cadenza-backend-api");

        let request_count = meter
            .u64_counter("cadenza_http_requests")
            .with_description("Number of HTTP requests handled")
            .build();

        let request_duration = meter
            .f64_histogram("cadenza_http_request_duration_seconds")
            .with_description("HTTP request duration in seconds")
            .build();

        Self {
            registry,
            _provider: provider,
            request_count,
            request_duration,
        }
    }
}

pub async fn metrics_handler(State(metrics): State<Metrics>) -> Response {
    // .gather snapshots all metrics currently in registry
    let metric_families = metrics.registry.gather();
    let encoder = TextEncoder::new();
    let mut body = Vec::new();

    if encoder.encode(&metric_families, &mut body).is_err() {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            "failed to encode metrics",
        )
            .into_response();
    }

    (
        [(header::CONTENT_TYPE, encoder.format_type().to_owned())],
        body,
    )
        .into_response()
}

pub async fn record_http_metrics(
    State(metrics): State<Metrics>,
    request: Request,
    next: Next,
) -> Response {
    let start = Instant::now();

    let method = request.method().to_string();

    let route = request
        .extensions()
        .get::<MatchedPath>() // prevents stuff like /songs/{song_id} from getting split into multiple different paths depending on id
        .map(|path| path.as_str().to_owned())
        .unwrap_or_else(|| "unmatched".to_owned());

    let response = next.run(request).await;

    let elapsed_seconds = start.elapsed().as_secs_f64();
    let status_code = response.status().as_u16().to_string();

    let attributes = [
        KeyValue::new("method", method),
        KeyValue::new("route", route),
        KeyValue::new("status_code", status_code),
    ];

    metrics.request_count.add(1, &attributes);
    metrics
        .request_duration
        .record(elapsed_seconds, &attributes);

    response
}
