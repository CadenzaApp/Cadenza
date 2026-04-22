import Constants from "expo-constants";
import { Platform } from "react-native";

const DEFAULT_BACKEND_API_BASE_URL = "http://127.0.0.1:3000";
const ANDROID_EMULATOR_BACKEND_API_BASE_URL = "http://10.0.2.2:3000";

type SourceProvider =
    | "apple_music"
    | "spotify"
    | "local"
    | "deezer";

type RequestSongTagSuggestionsInput = {
    jwt: string;
    songId: string;
    title: string;
    artist: string;
    album?: string;
    sourceProvider?: SourceProvider;
    requestedTagCount?: number;
};

type TagGenerationSongResponse = {
    song_id: string;
    suggested_tags: string[];
};

type ErrorResponse = {
    error_type?: string;
    message?: string;
};

function stripTrailingSlashes(value: string) {
    return value.replace(/\/+$/, "");
}

function normalizeApiBaseUrl(value: string) {
    return stripTrailingSlashes(value).replace(/\s+/g, "");
}

function extractHost(rawHostUri: string) {
    const normalized = rawHostUri.includes("://")
        ? rawHostUri
        : `http://${rawHostUri}`;

    try {
        const parsed = new URL(normalized);
        return parsed.hostname || null;
    } catch {
        const [fallbackHost] = rawHostUri.split(":");
        return fallbackHost?.trim() || null;
    }
}

function inferBackendApiBaseUrlFromExpoHost() {
    const hostCandidates = [
        Constants.expoConfig?.hostUri,
        Constants.platform?.hostUri,
        Constants.experienceUrl,
    ];

    for (const rawHostUri of hostCandidates) {
        if (!rawHostUri) {
            continue;
        }

        const host = extractHost(rawHostUri);
        if (!host) {
            continue;
        }

        return `http://${host}:3000`;
    }

    return null;
}

function getBackendApiBaseUrl() {
    const raw = process.env.EXPO_PUBLIC_BACKEND_API_URL;
    if (raw?.trim()) {
        return normalizeApiBaseUrl(raw.trim());
    }

    const inferred = inferBackendApiBaseUrlFromExpoHost();
    if (inferred) {
        return inferred;
    }

    if (Platform.OS === "android") {
        return ANDROID_EMULATOR_BACKEND_API_BASE_URL;
    }

    return DEFAULT_BACKEND_API_BASE_URL;
}

export async function requestSongTagSuggestions({
    jwt,
    songId,
    title,
    artist,
    album,
    sourceProvider = "apple_music",
    requestedTagCount,
}: RequestSongTagSuggestionsInput): Promise<string[]> {
    const backendBaseUrl = getBackendApiBaseUrl();
    const endpoint = `${backendBaseUrl}/tag-generation`;

    let response: Response;
    try {
        response = await fetch(endpoint, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${jwt}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                song_id: songId,
                title,
                artist,
                album,
                source_provider: sourceProvider,
                requested_tag_count: requestedTagCount,
            }),
        });
    } catch {
        throw new Error(
            `Could not reach backend at ${endpoint}. Set EXPO_PUBLIC_BACKEND_API_URL to your machine IP (for example: http://192.168.1.25:3000).`,
        );
    }

    if (!response.ok) {
        let errorMessage = "Failed to get AI tag suggestions.";

        try {
            const errorPayload = (await response.json()) as ErrorResponse;
            if (errorPayload.message?.trim()) {
                errorMessage = errorPayload.message.trim();
            }
        } catch {
            // no-op: keep fallback message if error body isn't valid JSON
        }

        throw new Error(errorMessage);
    }

    const payload = (await response.json()) as TagGenerationSongResponse;
    return Array.isArray(payload.suggested_tags) ? payload.suggested_tags : [];
}
