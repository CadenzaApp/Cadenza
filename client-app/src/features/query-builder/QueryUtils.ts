import { BACKEND_URL } from "@/lib/backend";
import {
    QueryNode,
    QueryNodeLogic,
    PaletteItem,
    SlotAddress,
    LogicOperator,
    QueryJSONNode,
    QuerySongsApiResult,
} from "./types";
import { nanoid } from "nanoid/non-secure";

/** Create logic node with an amount of empty slots */
export function makeLogicNode(operator: LogicOperator): QueryNodeLogic {
    return {
        kind: "logic",
        id: nanoid(),
        operator,
        // NOT gets 1 slot, AND/OR start with exactly 2 empty slots
        children: operator === "not" ? [null] : [null, null],
    };
}

/** Deep clone a node so mutations are safe */
export function cloneNode(node: QueryNode): QueryNode {
    if (node.kind === "tag") return { ...node };
    else
        return {
            ...node,
            children: node.children.map((c) => (c ? cloneNode(c) : null)),
        };
}

/** Insert a palette item at a slot address, returning the new root */
// Called when a drop happends. Takes the root node (of the whole tree), where inside its dropped, and what is dropped
export function insertAtSlot(
    root: QueryNode | null,
    address: SlotAddress,
    item: PaletteItem,
): QueryNode {
    const newNode: QueryNode =
        item.kind === "tag"
            ? { kind: "tag", id: nanoid(), tag: item.tag }
            : makeLogicNode(item.operator);

    if (address.nodeId === "root") return newNode;
    if (!root) return newNode;
    if (!("index" in address)) return newNode;
    return updateNode(root, address.nodeId, address.index, newNode);
}

function updateNode(
    node: QueryNode,
    targetId: string,
    index: number | "append",
    replacement: QueryNode,
): QueryNode {
    if (node.kind === "tag") return node;

    if (node.id === targetId) {
        if (index === "append") {
            // Add replacement as next child
            if (node.operator === "not") {
                // NOT has exactly one child so just replace/fill it
                return { ...node, children: [replacement] };
            }

            // AND/OR: fill the first empty slot if one exists, otherwise push
            const next = [...node.children];
            const firstNull = next.indexOf(null);
            if (firstNull !== -1) {
                next[firstNull] = replacement;
            } else {
                next.push(replacement);
            }

            return { ...node, children: next };
        }

        // Drop on a specific slot: replace it in place
        const next = [...node.children];
        next[index] = replacement;
        return { ...node, children: next };
    }

    return {
        ...node,
        children: node.children.map((c) =>
            c ? updateNode(c, targetId, index, replacement) : c,
        ),
    };
}

/** Remove a node by id, returning the new root (null if root itself removed) */
export function removeNode(
    root: QueryNode | null,
    targetId: string,
): QueryNode | null {
    if (!root) return null;
    if (root.id === targetId) return null;
    if (root.kind === "tag") return root;

    const nextChildren = root.children.map((c) =>
        c ? removeNode(c, targetId) : null,
    );

    let pruned: (QueryNode | null)[];
    if (root.operator === "not") {
        pruned = [nextChildren[0] ?? null];
    } else {
        // Keep filled children; pad back up to 2 slots so there are always
        // empty drop targets when the node has fewer than 2 children
        const filled = nextChildren.filter((c) => c !== null) as QueryNode[];
        const emptyNeeded = Math.max(0, 2 - filled.length);
        pruned = [...filled, ...Array(emptyNeeded).fill(null)];
    }

    return { ...root, children: pruned };
}

/** Find a node by id, or null if not found */
export function findNodeById(
    root: QueryNode | null,
    id: string,
): QueryNode | null {
    if (!root) return null;
    if (root.id === id) return root;
    if (root.kind === "tag") return null;
    for (const child of root.children) {
        const found = child ? findNodeById(child, id) : null;
        if (found) return found;
    }
    return null;
}

// throws string "incomplete query" if there are null spots in the query
function queryNodeToJSON(node: QueryNode): QueryJSONNode {
    if (node.kind === "tag") {
        return Number(node.tag.id);
    }

    // ensure at least 1 child, and none are null
    if (node.children.length == 0) throw "incomplete query";
    for (const child of node.children) {
        if (child == null) throw "incomplete query";
    }

    if (node.operator == "not") {
        return { not: queryNodeToJSON(node.children[0]!) };
    }

    const childJSON: QueryJSONNode[] = [];
    for (const child of node.children) {
        childJSON.push(queryNodeToJSON(child!));
    }

    return { [node.operator]: childJSON } as QueryJSONNode;
}

export async function getSongsFromQuery(
    query: QueryNode,
    accessToken: string,
): Promise<QuerySongsApiResult> {

    const resp = await fetch(`${BACKEND_URL}/queries`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${accessToken}`
        },
        body: JSON.stringify(queryNodeToJSON(query)),
    });
    const json = await resp.json();

    if (!resp.ok) {
        throw json;
    }

    return json as QuerySongsApiResult;
}
