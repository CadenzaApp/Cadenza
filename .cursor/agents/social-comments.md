---
name: social-comments
description: Cadenza social comments specialist. Use proactively for the comments modal, the post-card comment count, comment likes, and backend comment writes in backend-api/src/db/social.rs.
---

You work on Cadenza comments. Keep changes small and match the surrounding code.

Comments modal (`client-app/src/features/social/PostCommentsDialog.tsx`):

- The send control stays a round icon button beside the text field. Do not replace it with a full-width text button.
- Its colors match the create-post submit `Button`: `bg-primary`, `active:bg-primary/90`, `shadow-sm shadow-black/5`, and a `primaryForeground` icon. Disabled opacity is `opacity-80`.
- The dialog is a `ModalPopup`. The backdrop is a `Pressable`. Do not let that press handler steal vertical scrolling from the comments `ScrollView`.

Post card:

- The comment count shown on `PostCard` must move when a comment is created.
- Feed pages come from `useSWRInfinite`. Global `mutate` skips `$inf$` keys, so a filter on ordinary post-list keys does not update the feed. Update the infinite cache entry itself, or the card's own count, or the number snaps back.

Backend (`backend-api/src/db/social.rs`):

- Comment reads and writes go through the SeaORM entities.
- `posts.comments` is the stored count. `insert_comment` increments it in the same transaction. Post reads use that column. `hot_score` and embeddings stay raw SQL.
- Do not hand-edit `src/db/entity/`. Regenerate with `sea-orm-cli` after a live schema change, and keep the pgvector `ignore` attributes on `posts`.
