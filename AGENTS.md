# Agent Guidance

## Client data hooks and SWR

- Prefer SWR for hooks that read idempotent asynchronous data from the backend,
  Apple Music, or another remote source—especially when multiple components may
  request the same data or benefit from cached loading, error, and revalidation
  state.
- Reuse the wrappers in `client-app/src/lib/swr-utils.ts`, the endpoint hooks in
  `client-app/src/lib/routes`, and the MusicKit hooks in
  `client-app/src/lib/musickit-hooks.ts` before introducing another fetching
  pattern.
- Make every cache key stable and complete. Include all parameters that can
  change the response, such as IDs, query text, filters, limits, and resource
  types. Use a `null` key when required inputs or authorization are unavailable.
- Return SWR's data, loading, and error state from read hooks instead of
  duplicating them with `useState` and `useEffect`.
- Use `useSWRMutation` or the existing mutation wrappers for user-triggered
  writes. Invalidate or update every affected read key; use optimistic updates
  only when rollback behavior is defined.
- Do not use SWR for local presentation state, playback commands, animation
  state, or subscriptions to continuously changing native/external stores.
  Keep one-off imperative work imperative when its result is not reusable
  cached data.
- Before adding a manual fetch effect, check whether it is an idempotent read.
  If it is, default to an SWR-backed hook unless lifecycle or consistency
  requirements make SWR unsuitable, and document that exception briefly.
