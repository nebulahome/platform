/**
 * Handing the person a file to save: a log, a key, an export - text the browser already holds.
 */

/**
 * Hands the person a text file to save, through the browser's own download.
 *
 * @param name - What the file is called.
 * @param text - What it holds.
 * @param type - Its media type: `text/plain`, `application/json`.
 */
export function saveTextFile(name: string, text: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement('a');

  link.href = url;
  link.download = name;
  link.click();

  // The download has started from the link; the address is not needed after this turn.
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 0);
}
