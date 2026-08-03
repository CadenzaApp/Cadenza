import useSWR from "swr";
import { Alert } from "react-native";
import { useAccount } from "@/lib/account";
import { useAPIAction, useMutation } from "../swr-utils";

export type Tag = {
    id: number;
    name: string;
    color: string;
};

type TagWithMetadata = { tag: Tag; count: number };

export function useLocalTags() {
    const { account } = useAccount();

    const {
        data = [],
        error,
        isLoading,
    } = useSWR(["tags"], async () => {
        const resp = await fetch("/tags/local", {
            headers: {
                Authorization: `Bearer ${account?.jwt}`,
            },
        });
        return (await resp.json()) as TagWithMetadata[];
    });

    return { data, error, isLoading };
}

type UseTagsOnSongData = {
    global: Tag[];
    local: Tag[];
};

export function useTagsOnSong(songId: string) {
    const { account } = useAccount();

    const {
        data: tags = [],
        error,
        isLoading,
    } = useSWR(
        ["tags", `song_id=${songId}`],
        async () => {
            const resp = await fetch(`/tags?song_id=${songId}`, {
                headers: {
                    Authorization: `Bearer ${account?.jwt}`,
                },
            });
            return (await resp.json()) as UseTagsOnSongData;
        },
    );

    return { tags, error, isLoading };
}

type NewTagPayload = {
    name: string;
    color: string;
};
export function useCreateTag() {
    return useAPIAction<NewTagPayload, number>(["tags"], "POST", "/tags/local");
}

export function useDeleteTag() {
    return useAPIAction<{ tag_id: number }, void>(
        ["tags"],
        "POST",
        "/tags/local",
    );
}

type ApplyTagPayload = {
    song_id: string;
    tag_id: number;
};

export function useApplyTag() {
    return useAPIAction<ApplyTagPayload, void>(["tags"], "POST", "/tags/local");
}

export function useUnapplyTag() {
    return useAPIAction<ApplyTagPayload, void>(
        ["tags"],
        "POST",
        "/tags/local",
    );
}

