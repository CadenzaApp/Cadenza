import { TopEntityScreen } from "@/features/analytics/TopEntityScreen";

export default function TopArtistsScreen() {
    return (
        <TopEntityScreen
            dimension="artist"
            title="Most Listened Artists"
            emptyLabel="No artists recorded in this window yet."
            roundArtwork
        />
    );
}
