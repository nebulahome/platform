/** Where the fixture's devices listen. */
export const PORT = 4003;

/**
 * A packet the fixture's devices understand.
 *
 * @param text - What it says.
 * @returns The packet.
 */
export function packetOf(text: string): string {
  return JSON.stringify({ msg: text });
}
