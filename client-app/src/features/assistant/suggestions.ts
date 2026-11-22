/**
 * Things to try, shown on the empty chat as a scrolling list. A tap puts one in
 * the composer to send or edit. One or more for each kind of thing the
 * assistant can do (each tool it has), so the list shows off what it can do,
 * not only questions. Written the way a user would type them; names like "my
 * chill tag" are examples the user changes before sending.
 *
 * Import-free, so it runs under `node --test`.
 */
export const ASSISTANT_SUGGESTIONS: readonly string[] = [
    // tags and songs (list_tags, get_song_tags, get_song_metadata)
    "Which tags do I use the most?",
    "What tags are on the song that's playing?",
    "Tell me about the song that's playing",
    // queries (run_query, and opening the query builder)
    "Show my chill songs I haven't played in a month",
    "Find songs from 2019 I never played",
    "Which of my songs are tagged both gym and upbeat?",
    "Build a query for my unplayed songs in the advanced builder",
    "Sort my road trip songs by release date",
    // listening (top_items, listening_summary)
    "What were my top 10 songs this month?",
    "Who are my top artists this year?",
    "Which tags did I listen to most last week?",
    "How much music did I listen to this week?",
    "What do I listen to most late at night?",
    // songs from what it knows (find_songs, browse_apple_music, edit_card)
    "Give me 10 iconic video game songs",
    "Find songs like Redbone",
    "Show me 15 underrated 90s one-hit wonders",
    "Give me the best songs from the Interstellar soundtrack",
    "10 Pokémon songs, then add 3 Zelda ones",
    "Take the slow songs off that list",
    // Apple Music (search_apple_music, find_artist, find_album, get_album_songs)
    "Search Apple Music for lofi study beats",
    "Show me Frank Ocean's top songs",
    "Play the album Blonde",
    "What's on the Rumours album?",
    // playback (play, playback, queue_songs, set_shuffle, set_repeat, now_playing)
    "Play my gym songs",
    "Shuffle my favorite saved query",
    "What song is this?",
    "Skip this song",
    "Queue some upbeat songs next",
    "Put this song on repeat",
    "Turn shuffle off",
    "Play Daft Punk's top songs",
    // Apple Music library (apple_music_playlists, apple_music_playlist_songs,
    // favorite_song, favorite_collection, create/add Apple Music playlists)
    "What Apple Music playlists do I have?",
    "Play my Apple Music workout playlist",
    "Favorite this song",
    "Favorite the album that's playing",
    "Make an Apple Music playlist of my 2010s throwbacks",
    "Add this song to my Apple Music road trip playlist",
    // saved queries (list_saved_queries, get_saved_query_songs, save, rename)
    "What saved queries do I have?",
    "Save my 90s rock songs as a query",
    "Rename my gym saved query to Leg Day",
    // shared playlists (list_playlists, get_playlist_songs, edit, update)
    "Which shared playlists am I in?",
    "What's in my shared summer playlist?",
    "Add 5 beach songs to my shared summer playlist",
    "Move this song to the top of my shared playlist",
    "Rename my shared playlist to Summer Drive",
    // changing tags (apply_tag, remove_tag, create_tag, update_tag)
    "Tag everything by Frank Ocean as late night",
    "Make a red tag called Road Trip",
    "Tag these songs as chill",
    "Remove the workout tag from my slow songs",
    "Rename my chill tag to Mellow",
    "Make my focus tag blue",
    // the activity log (list_recent_actions, undo_action)
    "What changes have you made lately?",
    "Undo my last change",
    // getting around (open_screen)
    "Open my appearance settings",
    "Take me to my chill tag",
    "Open the query builder",
];

/**
 * `items` in a random order, every item once (Fisher-Yates). `random` is
 * `Math.random` unless a test passes its own.
 */
export function shuffled<T>(
    items: readonly T[],
    random: () => number = Math.random,
): T[] {
    const out = [...items];
    for (let i = out.length - 1; i > 0; i -= 1) {
        const j = Math.floor(random() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
}
