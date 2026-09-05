/**
 * The one or two letters that stand in for a face.
 *
 * Its own module because three screens want it - the rail, the profile card and the table of
 * people - and a helper that lives in whichever component happened to need it first is a helper
 * every later caller imports through the wrong door.
 */

/**
 * Builds the initials shown in an avatar.
 *
 * @param displayName - The name the person chose.
 * @returns One or two letters.
 */
export function toInitials(displayName: string): string {
  const words = displayName.trim().split(/\s+/).filter(Boolean);
  const first = words[0]?.[0] ?? '?';
  const last = words.length > 1 ? (words[words.length - 1]?.[0] ?? '') : '';

  return (first + last).toUpperCase();
}
