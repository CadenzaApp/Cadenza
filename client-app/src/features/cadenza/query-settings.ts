import AsyncStorage from "@react-native-async-storage/async-storage";

const STORAGE_KEY = "cadenza.query-builder.settings.v1";

export type QuerySettings = {
    includeSuggested: boolean;
    showVennDiagrams: boolean;
    showUndoRedo: boolean;
    showAdvancedTags: boolean;
    showMetadataTags: boolean;
};

export const DEFAULT_QUERY_SETTINGS: QuerySettings = {
    includeSuggested: false,
    showVennDiagrams: true,
    showUndoRedo: true,
    showAdvancedTags: true,
    showMetadataTags: false,
};

export async function loadQuerySettings(): Promise<QuerySettings> {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_QUERY_SETTINGS;

    const saved: unknown = JSON.parse(raw);
    if (!saved || typeof saved !== "object" || Array.isArray(saved)) {
        return DEFAULT_QUERY_SETTINGS;
    }
    const values = saved as Record<string, unknown>;
    return {
        includeSuggested:
            typeof values.includeSuggested === "boolean"
                ? values.includeSuggested
                : DEFAULT_QUERY_SETTINGS.includeSuggested,
        showVennDiagrams:
            typeof values.showVennDiagrams === "boolean"
                ? values.showVennDiagrams
                : DEFAULT_QUERY_SETTINGS.showVennDiagrams,
        showUndoRedo:
            typeof values.showUndoRedo === "boolean"
                ? values.showUndoRedo
                : DEFAULT_QUERY_SETTINGS.showUndoRedo,
        showAdvancedTags:
            typeof values.showAdvancedTags === "boolean"
                ? values.showAdvancedTags
                : DEFAULT_QUERY_SETTINGS.showAdvancedTags,
        showMetadataTags:
            typeof values.showMetadataTags === "boolean"
                ? values.showMetadataTags
                : DEFAULT_QUERY_SETTINGS.showMetadataTags,
    };
}

export function saveQuerySettings(settings: QuerySettings): Promise<void> {
    return AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}
