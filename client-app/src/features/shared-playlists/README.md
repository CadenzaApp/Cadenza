# shared-playlists

Cadenza owned playlists several people edit. The backend owns them; Apple Music only sees "Save a
copy". Titles and art come from Apple Music by catalog id.

| file                              | role                                                                                                                    |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `SharedPlaylistsScreen.tsx`       | `/social/playlists`: the caller's playlists, new playlist, enter code.                                                  |
| `SharedPlaylistScreen.tsx`        | `/social/playlist/:id` on `TrackCollectionView`: play, add, move, remove, invite, rename, save a copy, leave or delete. |
| `SharedPlaylistMembersScreen.tsx` | `/social/playlist/:id/members`: roles, remove, invite, add friends.                                                     |
| `roles.ts`                        | Role labels and the roles an owner can give.                                                                            |

Gotchas:

- One song can be in twice, so each row's track id is `entry:{entry_id}`, with the catalog id
  kept as `catalogId` and `playbackId` so it still plays.
- Writes send the version they loaded; on `VersionConflict` the screen refetches and says
  "Playlist changed, try again."
- Other members' changes arrive through the realtime socket (`useSharedPlaylist`).
- Viewers read and play. Editors change songs. The owner also renames, invites, manages members,
  and deletes. The owner leaving deletes it.
