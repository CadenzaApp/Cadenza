import {
    ComingSoonScreen,
    type FeaturePreview,
} from "@/components/custom/coming-soon-screen";

const FEATURES: FeaturePreview[] = [
    {
        icon: "pulse-outline",
        title: "Friend activity",
        description: "See what the people you follow are playing.",
    },
    {
        icon: "share-social-outline",
        title: "Shared mixes",
        description: "Build and trade Cadenza mixes with friends.",
    },
    {
        icon: "people-circle-outline",
        title: "Listening circles",
        description: "Bring people together around tags and moods.",
    },
];

export default function SocialScreen() {
    return (
        <ComingSoonScreen
            icon="people-outline"
            headline="Music is better together."
            description="Connect with friends through the songs, tags, and mixes that define your listening."
            actionLabel="Find friends"
            features={FEATURES}
        />
    );
}
