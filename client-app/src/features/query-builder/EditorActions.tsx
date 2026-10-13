import { createContext, useContext } from "react";
import type { Tag } from "@/lib/types";
import type { QueryTag } from "./types";

export const EditorActionsContext = createContext({
    showVennDiagrams: true,
    toggleOuterConnector: () => {},
    removeGroup: (_id: string) => {},
    removeQueryTag: (_id: string) => {},
    editQueryTag: (_tag: QueryTag) => {},
    pendingTag: null as { tag: Tag; suggested: boolean } | null,
    placeTagInCondition: (_id: string) => {},
    placeTagInNewCondition: () => {},
});
export const useEditorActions = () => useContext(EditorActionsContext);
