# Candidates before unrestricted public access

These are review and hardening suggestions, not implemented controls or an
approved scope of work. The CloudFront home-IP restriction stays enabled.

## Priorities

- Add per-user limits and quotas for paid tag-generation requests. Existing tag
  count and description caps do not limit request frequency or total spend.
  Provider 429 handling is not an incoming application rate limit.
  With multiple replicas, enforce the intended aggregate quota across instances.
- Bound expensive work across the server: model concurrency, queued requests,
  database work, and timeouts. Reject overload deliberately instead of allowing
  queues or memory use to grow without a bound. Keep the existing DB pool cap.
- Add explicit semantic limits for interest batches and names, and review other
  list/query inputs. The interest-update route currently validates the interest
  type but has no explicit item-count or name-length limit; missing interest
  embeddings are submitted together. General HTTP body limits are not enough.
- Return generic database/upstream failure messages to clients. Keep diagnostic
  details in private server logs, with credentials and sensitive data redacted.
- Test two authenticated accounts against private reads and writes, including
  guessed resource IDs and account switching. Multi-device use and simultaneous
  user isolation remain unverified. Review Supabase RLS and DB role privileges.
- Review Supabase signup settings and JWT validation. Login is not an invitation
  policy if anyone can create an account. For testing from arbitrary networks,
  consider an approved-user-ID allowlist rather than unrestricted membership.

## Additional options

- Consider edge request-rate limits, such as AWS WAF, alongside application
  limits. Evaluate cost and legitimate library-sync traffic before enabling.
  Keep the EC2 origin restricted to CloudFront even after broadening viewers.
- Review monitoring, alerts, restore/rollback procedures, dependency updates,
  and service spending controls before a wider release. Budget alerts notify;
  they do not enforce an application spending cap.
- Test realistic concurrent users and performance with depleted Standard CPU
  credits. The current single-user checks do not establish public-load capacity.

## Evidence and current scope

The API verifies Supabase JWTs and the reviewed handlers derive the user ID from
claims. HTTPS, private-origin routing, uncached API forwarding, model inference,
and single-user phone flows have passed. This is not a complete security audit.

Relevant code: `backend-api/src/main.rs`, `backend-api/src/auth.rs`,
`backend-api/src/routes/tags.rs`, `backend-api/src/routes/social.rs`,
`backend-api/src/services/social_feed.rs`, and `backend-api/src/err.rs`.
