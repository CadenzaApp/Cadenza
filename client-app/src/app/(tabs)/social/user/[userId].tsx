import { useLocalSearchParams } from "expo-router";

import { UserProfileScreen } from "@/features/social/UserProfileScreen";

export default function SocialUserProfileRoute() {
    const { userId: raw } = useLocalSearchParams<{ userId: string }>();
    const userId = Array.isArray(raw) ? raw[0] : raw;
    if (!userId) return null;
    return <UserProfileScreen userId={userId} />;
}
