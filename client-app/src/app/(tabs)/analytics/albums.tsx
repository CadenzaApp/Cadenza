import { TopEntityScreen } from "@/features/analytics/TopEntityScreen";

export default function TopAlbumsScreen() {
    return (
        <TopEntityScreen
            dimension="album"
            title="Most Listened Albums"
            emptyLabel="No albums recorded in this window yet."
        />
    );
}
