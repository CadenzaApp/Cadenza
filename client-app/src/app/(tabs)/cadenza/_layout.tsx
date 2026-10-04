import { TabStack } from "@/components/custom/tab-stack";

/** The results summary sits fixed above the builder, so the rail stays put. */
const PINNED_RAIL = ["index"];

export default function CadenzaLayout() {
    return <TabStack title="Cadenza" pinnedRail={PINNED_RAIL} />;
}
