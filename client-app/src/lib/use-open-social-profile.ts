import { useNavigation } from "expo-router";
import { useCallback } from "react";

import { socialProfileNavigateAction } from "./open-profile";

/**
 * Closes the screen covering the tabs and shows this user on the Social tab.
 * Discuss uses it for an author tap. The feed's own author tap pushes instead,
 * because that screen is already the Social tab.
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
