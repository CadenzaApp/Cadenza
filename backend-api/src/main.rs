use axum::{Router, routing::get};
use axum_server::tls_rustls::RustlsConfig;
use std::net::SocketAddr;

#[tokio::main]
async fn main() {
    // Load certificates
    let config = RustlsConfig::from_pem_file("certs/cert.pem", "certs/key.pem")
        .await
        .expect("Failed to load certificates");

    let app = Router::new().route("/", get(|| async { "Hello, HTTPS!" }));
    let addr = SocketAddr::from(([127, 0, 0, 1], 3000));

    println!("Running on https://{}", addr);
    axum_server::bind_rustls(addr, config)
        .serve(app.into_make_service())
        .await
        .unwrap();
}
