import { TabStack } from "@/components/custom/tab-stack";

/** The search field sits fixed above the landing, so the rail stays put. */
const PINNED_RAIL = ["index"];

export default function SearchLayout() {
    return <TabStack title="Search" pinnedRail={PINNED_RAIL} />;
}
