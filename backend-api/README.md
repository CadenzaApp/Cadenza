# Setup

Because this is an HTTPS server, you'll need to self-sign some certs to get this running. Follow the steps in `certs/readme.md`

You'll also need to add a .env file to the current directory that contains a `DATABASE_URL` key. Should look like:

```
DATABASE_URL=postgresql://postgres:[DATABASE-PASSWORD]@db.[PROJECT-ID].supabase.co:5432/postgres
```

The current code is set up to work with a random test database David set up (as of 2026-04-01), if you want to just run what he's got up message him and ask for his .env variable.

Uses Sea ORM to generate bindings to the supabase database. To install the Sea ORM CLI:

```sh
cargo install sea-orm-cli@^2.0.0-rc
```

To rebuild database bindings:

```sh
generate entity -o ./src/entity --entity-format dense
```

# Running

Once you've done that, you can just
`cargo run --release`
