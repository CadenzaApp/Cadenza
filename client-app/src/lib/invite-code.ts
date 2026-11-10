/**
 * Invite codes as the user types or pastes them. Import-free, so
 * `invite-code.test.ts` runs it under `node --test`.
 */

/** No `0 O 1 I L`, matching the backend. */
export const INVITE_CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
export const INVITE_CODE_LENGTH = 8;

/**
 * A code as typed or pasted: a `cadenza://join/CODE` link reduced to its code,
 * uppercased, and anything outside the alphabet dropped. At most 8 chars.
 */
export function cleanInviteCode(input: string): string {
    const fromLink = input.match(/join\/([A-Za-z0-9-]+)/)?.[1] ?? input;
    return fromLink
        .toUpperCase()
        .split("")
        .filter((char) => INVITE_CODE_ALPHABET.includes(char))
        .join("")
        .slice(0, INVITE_CODE_LENGTH);
}
