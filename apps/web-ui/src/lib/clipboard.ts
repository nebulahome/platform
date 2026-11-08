/**
 * Putting something on the clipboard.
 *
 * Wrapped rather than called directly because the API fails in two different ways that a caller
 * has to treat the same: it is absent outside a secure context - a hub opened at its plain
 * `http://` address - and it rejects when the document has no permission or is not focused.
 * Without it the text is copied the old way, from a hidden field; when that fails too the person
 * will have to select the text themselves, which is why the text is always on screen as well as
 * on the button.
 */

/**
 * Copies text from a hidden field, as pages did before the clipboard API. The field goes inside
 * the open dialog, when there is one: under a modal dialog the rest of the page is inert, and
 * nothing in it can be selected.
 *
 * @param value - What to copy.
 * @returns True when the browser says it copied.
 */
function copyTheOldWay(value: string): boolean {
  const field = document.createElement('textarea');
  const host = document.activeElement?.closest('dialog') ?? document.body;
  const before = document.activeElement;

  field.value = value;
  field.setAttribute('readonly', '');
  field.style.position = 'fixed';
  field.style.opacity = '0';
  host.append(field);
  field.select();

  try {
    // Deprecated, but the only way left where the clipboard API is not offered.
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- see above
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    field.remove();

    if (before instanceof HTMLElement) {
      before.focus();
    }
  }
}

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
    return copyTheOldWay(value);
  }
}
