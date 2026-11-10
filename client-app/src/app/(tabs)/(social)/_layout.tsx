import { TabStack } from "@/components/custom/tab-stack";

/** Puts the tab's own index under a detail route opened by deep link. */
export const unstable_settings = { initialRouteName: "social/index" };

export default function SocialLayout() {
    return <TabStack tab="social" title="Social" />;
}
