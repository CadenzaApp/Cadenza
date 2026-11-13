# shared-playlists

Cadenza owned playlists several people edit. The backend owns them; Apple Music only sees "Save a
copy". Titles and art come from Apple Music by catalog id.

| file                              | role                                                                                                                                                                                                                                             |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `SharedPlaylistsScreen.tsx`       | `SharedPlaylistsList`: the caller's playlists on `LibraryList`, the same list as Library > Queries: search, new playlist, enter code, play and shuffle. Library > Playlists shows it under Shared playlists; `/social/playlists` shows it alone. |
| `SharedPlaylistScreen.tsx`        | `/shared-playlist/:id` on `TrackCollectionView`: play, add, remove, invite, rename, share to feed, save a copy, leave or delete.                                                                                                                 |
| `SharedPlaylistReorderScreen.tsx` | `/shared-playlist/:id/reorder`: drag songs into a new order, on `ReorderableList`. Editors and the owner.                                                                                                                                        |
| `SharedPlaylistMembersScreen.tsx` | `/shared-playlist/:id/members`: roles, remove, invite, add friends.                                                                                                                                                                              |
| `use-playlist-tracks.ts`          | Entries as playable tracks, titles and art from Apple Music, each with its `entry:{entry_id}` id.                                                                                                                                                |
| `roles.ts`                        | Role labels and the roles an owner can give.                                                                                                                                                                                                     |

Gotchas:

- One song can be in twice, so each row's track id is `entry:{entry_id}`, with the catalog id
  kept as `catalogId` and `playbackId` so it still plays.
- Writes send the version they loaded; on `VersionConflict` the screen refetches and says
  "Playlist changed, try again."
- Other members' changes arrive through the realtime socket (`useSharedPlaylist`).
- Reorder is its own screen because the detail screen's list is the shared `MusicList`, which
  does not drag. Each drop is one move.
- Share to feed posts with `shared_playlist_id`. Anyone who sees the post sees the card
  (`social/SharedPlaylistPostCard.tsx`); a non member who taps it gets the private screen.
- Viewers read and play. Editors change songs. The owner also renames, invites, manages members,
  and deletes. The owner leaving deletes it.
