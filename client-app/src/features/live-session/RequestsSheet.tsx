import type { ReactNode } from "react";
import { ScrollView, View } from "react-native";

import { BottomSheet } from "@/components/custom/bottom-sheet";
import { Text } from "@/components/ui/text";
import {
    useLiveSessionWrites,
    type LiveSession,
} from "@/lib/routes/live-sessions";

import { AnswerButtons, EntryRow, runSessionWrite } from "./session-parts";

/**
 * A live session's Requests, in a sheet over the player, full width and flush
 * with the bottom: people waiting to join and songs suggested, each let
 * through with the green check or turned down with the red X. For whoever
 * reviews suggestions: the host, controllers, and queue editors. Join
 * requests reach the host alone.
 */
export function RequestsSheet({
    session,
    visible,
    onClose,
}: {
    session: LiveSession;
    visible: boolean;
    onClose: () => void;
}) {
    const writes = useLiveSessionWrites(session.session_id);
    const suggestions = session.suggestions;
    const joins = session.join_requests;

    return (
        <BottomSheet visible={visible} onClose={onClose} title="Requests">
            <ScrollView contentContainerStyle={{ paddingBottom: 16 }}>
                {joins.length > 0 ? (
                    <Section title="Want to join">
                        {joins.map((request, index) => (
                            <View key={request.user_id}>
                                {index > 0 ? (
                                    <View className="ml-4 h-px bg-border" />
                                ) : null}
                                <View className="h-16 flex-row items-center gap-3 px-4">
                                    <Text
                                        className="min-w-0 flex-1 text-base font-medium text-foreground"
                                        numberOfLines={1}
                                    >
                                        {request.username}
                                    </Text>
                                    <AnswerButtons
                                        rejectLabel={`Don't let ${request.username} in`}
                                        acceptLabel={`Let ${request.username} in`}
                                        onReject={() =>
                                            void runSessionWrite(
                                                () =>
                                                    writes.answerJoinRequest(
                                                        request.user_id,
                                                        false,
                                                    ),
                                                "Couldn't answer.",
                                            )
                                        }
                                        onAccept={() =>
                                            void runSessionWrite(
                                                () =>
                                                    writes.answerJoinRequest(
                                                        request.user_id,
                                                        true,
                                                    ),
                                                "Couldn't let them in.",
                                            )
                                        }
                                    />
                                </View>
                            </View>
                        ))}
                    </Section>
                ) : null}

                <Section title="Suggested songs">
                    {suggestions.length === 0 ? (
                        <Text className="px-4 py-6 text-center text-sm text-muted-foreground">
                            No suggestions waiting.
                        </Text>
                    ) : (
                        suggestions.map((entry, index) => (
                            <EntryRow
                                key={entry.entry_id}
                                entry={entry}
                                first={index === 0}
                                trailing={
                                    <AnswerButtons
                                        rejectLabel={`Reject ${entry.title} from ${entry.added_by_username ?? "someone"}`}
                                        acceptLabel={`Approve ${entry.title} from ${entry.added_by_username ?? "someone"}`}
                                        onReject={() =>
                                            void runSessionWrite(
                                                () =>
                                                    writes.reviewSuggestion(
                                                        entry.entry_id,
                                                        false,
                                                    ),
                                                "Couldn't reject it.",
                                            )
                                        }
                                        onAccept={() =>
                                            void runSessionWrite(
                                                () =>
                                                    writes.reviewSuggestion(
                                                        entry.entry_id,
                                                        true,
                                                    ),
                                                "Couldn't approve it.",
                                            )
                                        }
                                    />
                                }
                            />
                        ))
                    )}
                </Section>
            </ScrollView>
        </BottomSheet>
    );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
    return (
        <View className="pb-4">
            <Text className="px-4 pb-1 pt-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                {title}
            </Text>
            {children}
        </View>
    );
}
