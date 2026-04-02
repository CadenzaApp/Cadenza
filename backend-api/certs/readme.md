# Steps for generating an HTTPs cert for local development:

1. Install mkcert
2. Install local CA via `mkcert -install`
3. `mkcert -key-file key.pem -cert-file cert.pem localhost 127.0.0.1 ::1`
