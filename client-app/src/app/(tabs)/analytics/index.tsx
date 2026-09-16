import {
    ComingSoonScreen,
    type FeaturePreview,
} from "@/components/custom/coming-soon-screen";

const FEATURES: FeaturePreview[] = [
    {
        icon: "trending-up-outline",
        title: "Listening trends",
        description: "Follow how your listening habits change over time.",
    },
    {
        icon: "pricetags-outline",
        title: "Tag insights",
        description: "See which tags and moods define your library.",
    },
    {
        icon: "albums-outline",
        title: "Library breakdowns",
        description: "Understand the artists and albums you return to.",
    },
];

export default function AnalyticsScreen() {
    return (
        <ComingSoonScreen
            icon="stats-chart-outline"
            headline="See how you listen."
            description="Turn your Cadenza library into a clear picture of your taste and listening patterns."
            actionLabel="View insights"
            features={FEATURES}
        />
    );
}
