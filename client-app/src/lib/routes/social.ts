import { useAPIMutation } from "../api-actions";
import type { InterestScoreDelta } from "@/lib/types";

/**
 * Shrinks the signed in user's interest scores so the social feed follows what
 * they like now rather than what they liked months ago. The social feed service
 * skips it when it already decayed in the last 6 hours, so calling it more than
 * that is harmless. No body: the backend puts the user id in.
 */
export function useDecayInterests() {
    const x = useAPIMutation<void, void>("PATCH", "/social/interests/decay");
    return {
        decayInterestsErr: x.error,
        decayInterestsLoading: x.isMutating,
        resetDecayInterests: x.reset,
        decayInterests: x.trigger,
    };
}

type EditInterestScoresPayload = {
    delta_scores: InterestScoreDelta[];
};

/**
 * Moves the signed in user's interest score for each named artist or genre by
 * its delta, which is what the social feed ranks posts by. An interest they
 * have no score for starts at its delta. Responds with `null`.
 *
 * ```ts
 * await editInterestScores({
 *     delta_scores: [
 *         { name: "Phoebe Bridgers", itype: "artist", delta: 1 },
 *         { name: "Alternative", itype: "genre", delta: 1 },
 *     ],
 * });
 * ```
 *
 * The backend forwards it to the social feed service with the caller's user
 * id added, so the body never names a user.
 */
export function useEditInterestScores() {
    const x = useAPIMutation<EditInterestScoresPayload, null>(
        "PATCH",
        "/social/interests/update",
    );
    return {
        editInterestScoresErr: x.error,
        editInterestScoresLoading: x.isMutating,
        resetEditInterestScores: x.reset,
        editInterestScores: x.trigger,
    };
}
