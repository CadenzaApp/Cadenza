import { useNavigation } from "expo-router";
import { useCallback } from "react";

import { socialProfileNavigateAction } from "./open-profile";

/**
 * Closes the screen covering the tabs and shows this user on the Social tab.
 * Discuss uses it for an author tap. Account settings uses it for "Your Social
 * Page". The feed's own author tap and the Social tab profile button push
 * instead, because those screens are already the Social tab.
 */
export function useOpenSocialProfile() {
    const navigation = useNavigation();
    return useCallback(
        (userId: string) => {
            navigation.dispatch(socialProfileNavigateAction(userId));
        },
        [navigation],
    );
}
