import { TabStack } from "@/components/custom/tab-stack";

/** Puts the tab's own index under a detail route opened by deep link. */
export const unstable_settings = { initialRouteName: "cadenza/index" };

/** The results summary sits fixed above the builder, so the rail stays put. */
const PINNED_RAIL = ["index"];

export default function CadenzaLayout() {
    return <TabStack tab="cadenza" title="Cadenza" pinnedRail={PINNED_RAIL} />;
}
