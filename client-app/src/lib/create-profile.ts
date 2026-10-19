import { BACKEND_URL } from "./backend";

/**
 * Creates a profile for the user identified by `token`. Ignores
 * `ProfileAlreadyExists` when the auth trigger already wrote the row.
 *
 * Not a hook: `AccountProvider` calls this outside of React mutation state,
 * and it must not import the API hooks or account and profile form a cycle.
 */
export async function createProfile(token: string): Promise<void> {
    const resp = await fetch(`${BACKEND_URL}/profile`, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${token}`,
        },
    });

    if (resp.ok) return;

    const text = await resp.text();
    let data: { error_type?: string } = {};
    try {
        data = text ? JSON.parse(text) : {};
    } catch {
        // non-JSON body
    }
    if (data.error_type === "ProfileAlreadyExists") return;

    throw data.error_type
        ? data
        : {
              error_type: "HttpError",
              status: resp.status,
              message: text,
          };
}
