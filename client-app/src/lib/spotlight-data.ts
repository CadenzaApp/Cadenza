import type { ArtistDetail, MusicItem } from "@apple-musickit";
import { appleMusicStatus, classifyError } from "./app-error.ts";

type ResolvedMusicTopic =
    | { kind: "song"; item: MusicItem }
    | { kind: "artist"; item: ArtistDetail };

/** Posts store an untyped catalog id. A song miss can be an artist instead. */
export async function resolveMusicTopic(
    id: string,
    readSongs: (ids: string[]) => Promise<MusicItem[]>,
    readArtist: (id: string) => Promise<ArtistDetail>,
    timeoutMs = 20_000,
): Promise<ResolvedMusicTopic> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const lookup = async (): Promise<ResolvedMusicTopic> => {
        let songs: MusicItem[];
        let songFailure: unknown;
        try {
            songs = await readSongs([id]);
        } catch (error) {
            // MusicKit's typed Song request can reject an artist ID with an
            // opaque native error instead of an HTTP 404 or an empty result.
            const nativeResourceFailure =
                classifyError(error).kind === "unknown" &&
                appleMusicStatus(error) === null &&
                error instanceof Error &&
                error.message.includes("MusicKit.MusicDataRequest.Error");
            const missing =
                appleMusicStatus(error) === 404 ||
                classifyError(error).kind === "not-found";
            // Explicit authentication, network, and server failures still
            // belong to the shared read recovery, not a different resource.
            if (!missing && !nativeResourceFailure) throw error;
            if (nativeResourceFailure) songFailure = error;
            songs = [];
        }
        const song = songs.find(
            (item) => item.id === id || item.catalogId === id,
        );
        if (song) return { kind: "song", item: song };
        try {
            return { kind: "artist", item: await readArtist(id) };
        } catch (error) {
            if (songFailure) {
                throw new AggregateError(
                    [songFailure, error],
                    `Apple Music topic ${id} could not resolve as a song or artist.`,
                );
            }
            throw error;
        }
    };
    try {
        return await Promise.race([
            lookup(),
            new Promise<never>((_, reject) => {
                timer = setTimeout(
                    () =>
                        reject(
                            new Error("Apple Music topic lookup timed out."),
                        ),
                    timeoutMs,
                );
            }),
        ]);
    } finally {
        if (timer !== undefined) clearTimeout(timer);
    }
}

type Storage = {
    getItem: (key: string) => Promise<string | null>;
    setItem: (key: string, value: string) => Promise<unknown>;
};

/** Serializes dismissals so quick consecutive hides cannot overwrite each other. */
export function createHiddenSpotlightStore(storage: Storage) {
    const writes = new Map<string, Promise<number[]>>();
    async function read(key: string): Promise<number[]> {
        const raw = await storage.getItem(key);
        let ids: unknown;
        try {
            ids = raw ? JSON.parse(raw) : [];
        } catch {
            return [];
        }
        return Array.isArray(ids)
            ? ids.filter((id): id is number => Number.isSafeInteger(id))
            : [];
    }
    return {
        read,
        hide(key: string, postId: number): Promise<number[]> {
            const pending = (writes.get(key) ?? Promise.resolve([]))
                .catch(() => [])
                .then(async () => {
                    const ids = [...new Set([...(await read(key)), postId])];
                    await storage.setItem(key, JSON.stringify(ids));
                    return ids;
                });
            writes.set(key, pending);
            const cleanup = () => {
                if (writes.get(key) === pending) writes.delete(key);
            };
            void pending.then(cleanup, cleanup);
            return pending;
        },
    };
}
