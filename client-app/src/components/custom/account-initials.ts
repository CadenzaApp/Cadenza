/** Returns up to two initials from the local part of an email address. */
export function getAccountInitials(email?: string | null): string {
    const localPart = email?.split("@", 1)[0]?.trim();
    if (!localPart) return "?";

    const parts = localPart.split(/[._\-\s]+/).filter(Boolean);
    if (parts.length === 0) return "?";

    return parts
        .slice(0, 2)
        .map((part) => part[0])
        .join("")
        .toUpperCase();
}
