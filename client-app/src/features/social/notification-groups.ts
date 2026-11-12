import type { NotificationType, SocialNotification } from "@/lib/types";

/** A run of notifications of one type, next to each other in the list. */
export type NotificationGroup = {
    type: NotificationType;
    items: SocialNotification[];
};

/**
 * `items` cut into runs of the same type, in order. Three join requests, a
 * friend request, then five join requests is three groups: the friend
 * request keeps the join requests on either side apart.
 */
export function groupNotifications(
    items: SocialNotification[],
): NotificationGroup[] {
    const groups: NotificationGroup[] = [];
    for (const item of items) {
        const last = groups.at(-1);
        if (last?.type === item.type) last.items.push(item);
        else groups.push({ type: item.type, items: [item] });
    }
    return groups;
}

/** What a group of more than one says after the names. */
const GROUP_ACTION = {
    comment: "commented on your posts",
    friend_req_received: "sent you friend requests",
    friend_req_accepted: "accepted your friend requests",
    session_join_request: "want to join your session",
    session_join_accepted: "let you into their sessions",
} as const satisfies Record<NotificationType, string>;

/**
 * Who a group is from, like "ada, bo, and 3 others", then what they did.
 * A name in the group twice counts once.
 */
export function describeGroup(group: NotificationGroup): {
    names: string;
    action: string;
} {
    const people = [...new Set(group.items.map((item) => item.title))];
    const shown = people.slice(0, 2);
    const others = people.length - shown.length;
    const names =
        others > 0
            ? `${shown.join(", ")}, and ${others} other${others === 1 ? "" : "s"}`
            : shown.join(" and ");
    return { names, action: GROUP_ACTION[group.type] };
}
