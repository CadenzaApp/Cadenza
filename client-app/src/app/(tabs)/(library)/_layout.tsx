import { TabStack } from "@/components/custom/tab-stack";

/** Puts the tab's own index under a detail route opened by deep link. */
export const unstable_settings = { initialRouteName: "library/index" };

export default function LibraryLayout() {
    return <TabStack tab="library" title="Library" />;
}
