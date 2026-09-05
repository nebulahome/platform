/**
 * Putting something on the clipboard.
 *
 * Wrapped rather than called directly because the API fails in two different ways that a caller
 * has to treat the same: it is absent outside a secure context, and it rejects when the document
 * has no permission or is not focused. Both mean the person will have to select the text
 * themselves, which is why the text is always on screen as well as on the button.
 */

/**
 * Copies text.
 *
 * @param value - What to copy.
 * @returns True when the clipboard took it.
 */
export async function copyText(value: string): Promise<boolean> {
  try {
    await globalThis.navigator.clipboard.writeText(value);

    return true;
  } catch {
    return false;
  }
}
