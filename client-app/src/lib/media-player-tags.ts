import type { Tag } from "@/lib/types";

export type SongTag = Tag & { applied: boolean };

export interface SongTagRepository {
    listForSong(songId: string): Promise<SongTag[]>;
    toggleForSong(songId: string, tagId: string): Promise<SongTag[]>;
}

const DUMMY_TAGS: Tag[] = [
    { id: "focus", name: "Focus", color: "#2563eb" },
    { id: "chill", name: "Chill", color: "#0f766e" },
    { id: "late-night", name: "Late night", color: "#7c3aed" },
    { id: "road-trip", name: "Road trip", color: "#ea580c" },
    { id: "workout", name: "Workout", color: "#dc2626" },
    { id: "sunday", name: "Sunday", color: "#ca8a04" },
    { id: "new-music", name: "New music", color: "#0891b2" },
    { id: "throwback", name: "Throwback", color: "#be185d" },
];

class DummySongTagRepository implements SongTagRepository {
    private assignments = new Map<string, Set<string>>();

    async listForSong(songId: string) {
        let applied = this.assignments.get(songId);
        if (!applied) {
            applied = new Set(["focus", "late-night", "sunday"]);
            this.assignments.set(songId, applied);
        }
        return DUMMY_TAGS.map((tag) => ({
            ...tag,
            applied: applied.has(tag.id),
        }));
    }

    async toggleForSong(songId: string, tagId: string) {
        const applied = new Set(this.assignments.get(songId));
        if (applied.has(tagId)) applied.delete(tagId);
        else applied.add(tagId);
        this.assignments.set(songId, applied);

        console.info(
            "[MediaPlayer] Tag editing is incomplete. The selection changed locally but was not saved.",
        );
        return this.listForSong(songId);
    }
}

export const mediaPlayerTagRepository: SongTagRepository =
    new DummySongTagRepository();
