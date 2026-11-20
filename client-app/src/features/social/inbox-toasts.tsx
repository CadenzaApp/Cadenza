import { useToast } from "@/components/custom/toast";
import { useAccount } from "@/lib/account";
import { invalidateAPIData } from "@/lib/api-actions";
import { useRealtimeTopic } from "@/lib/realtime";
import type { NotificationType } from "@/lib/types";

/** What an inbox `notification` event carries. */
type InboxNotification = {
    type: NotificationType;
    content: string;
    metadata: { post_id?: number };
};

/**
 * Watches the signed-in user's inbox topic while the realtime socket is up.
 * A comment on one of their posts shows a toast with the comment, and any new
 * notification refetches the notifications list. Renders nothing. Mounted at
 * the root, under `ToastProvider`.
 *
 * A comment made while the socket was down gets no toast. It is still on the
 * notifications page.
 */
export function InboxToasts() {
    const { account } = useAccount();
    const { showToast } = useToast();

    useRealtimeTopic(
        account ? { kind: "inbox", id: account.id } : null,
        (event) => {
            if (event.kind !== "notification") return;
            void invalidateAPIData([{ path: "/social/notifications" }]);
            const notification = event.data as InboxNotification | null;
            if (notification?.type === "comment" && notification.content) {
                showToast(
                    notification.content,
                    "New post comment",
                    "chatbubble",
                );
            }
        },
    );

    return null;
}
