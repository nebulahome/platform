/**
 * A JSON body with `{{ name }}` where a parameter goes, checked and tidied as JSON.
 *
 * Each placeholder is swapped for something JSON can hold - a quoted marker where it stands for a
 * value, the bare marker inside a string - then parsed, indented, and swapped back, so the tokens
 * come through the tidying exactly as they were typed.
 */

/** `{{ name }}`, with or without spaces inside the braces. */
const PLACEHOLDER = /\{\{\s*[a-z][a-z0-9_]*\s*\}\}/gu;

/**
 * Whether a position in a JSON text is inside a string.
 *
 * @param text - The text.
 * @param at - The position.
 * @returns True after an odd number of unescaped quotes.
 */
function isInString(text: string, at: number): boolean {
  let inside = false;

  for (let index = 0; index < at; index += 1) {
    if (text[index] === '\\') {
      index += 1;
    } else if (text[index] === '"') {
      inside = !inside;
    }
  }

  return inside;
}

/**
 * Tidies a JSON body's indentation, its tokens kept.
 *
 * @param text - The body.
 * @returns It indented by two spaces, or null when it is not JSON with its tokens in place.
 */
export function formatJsonTemplate(text: string): string | null {
  const tokens: string[] = [];
  const swapped = text.replaceAll(PLACEHOLDER, (token: string, at: number) => {
    const index = String(tokens.push(token) - 1);

    return isInString(text, at) ? `@@s${index}@@` : `"@@v${index}@@"`;
  });

  /**
   * The token a marker stands for.
   *
   * @param marker - The marker.
   * @param index - Its number.
   * @returns The token as typed.
   */
  const back = (marker: string, index: string): string => tokens[Number(index)] ?? marker;

  try {
    return JSON.stringify(JSON.parse(swapped), null, 2)
      .replaceAll(/"@@v(\d+)@@"/gu, back)
      .replaceAll(/@@s(\d+)@@/gu, back);
  } catch {
    return null;
  }
}
