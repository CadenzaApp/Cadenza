# Public-access controls and known gaps

The CloudFront API is public. Its ALB and EC2 origin have private ingress.
Authentication and backend authorization are required for protected routes.
App distribution is not a security boundary: a person can create an account
through the project's public Supabase Auth signup flow.

## Controls in this branch

- Supabase's unused Data API is disabled. Auth and direct Postgres still work.
  Without this setting, absent RLS/overbroad table grants would be a serious
  direct-data-access exposure. Do not re-enable it without reviewing permissions.
- Database connections verify the CA and hostname. Production secrets are fetched
  from SSM on EC2, not embedded in images, code or phone configuration.
- Authenticated request quotas, tag-generation limits, a shared provider-call cap
  and provider concurrency bound protect the single instance. The assistant also
  has its own per-user message limits. Settings are documented in backend READMEs.
- The model has one worker and a bounded queue. Inputs, query trees, request
  deadlines and HTTP concurrency are limited. Overload returns deliberate errors.
- Database/provider failures return generic messages. Metrics use route templates
  without user IDs, request bodies, credentials or query strings.
- Selected live two-account checks passed for profile identity, tags and saved
  queries, including attempted reads/writes against another account's fixtures.
  `scripts/check-account-isolation.py` can repeat these checks with local prompts.
- Prometheus/Grafana are private through AWS-authenticated SSM tunnels. Grafana
  permits read-only viewing inside the tunnel, without an additional password.

## Accepted limits and follow-ups

Quotas are in memory, reset on restart and do not enforce a durable dollar budget.
External provider work can continue after an HTTP timeout. A model queue limit
protects resources but is not an abuse or billing guarantee. Use provider-side
spending controls and restricted keys where possible.

Existing ownership checks are not an audit of every endpoint. Social privacy and
mutations, library/settings writes, DB least privilege and the ML child's inherited
credentials need broader review. Readiness deliberately excludes remote providers,
and does not prove every expensive operation is making progress.

The team deferred backups and concurrent-user testing. Monitoring history is
local and is lost on replacement. There is one serving instance, so updates and
recovery interrupt service. Current verification is in
`recovery/verification.release.json`; detailed retired investigations remain in
Git history. See [the roadmap](../DEPLOYMENT_PLAN.md) for remaining work.
