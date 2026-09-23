/**
 * How every search box in the interface decides what matches.
 *
 * One rule, here, so the devices page, the aliases page and the entity picker answer the same
 * query the same way:
 *
 * - **Case and accents do not matter.** "citta" finds "Città", "CUCINA" finds "Cucina": text is
 *   folded to lower case and its combining marks removed before it is compared.
 * - **Every word must be found, in any order.** "printer workshop" finds "Workshop printer", and
 *   narrows as more words are typed rather than widening.
 * - **Each word is looked for in each field on its own.** The fields are never run together, so a
 *   word cannot match by straddling the end of one field and the start of the next.
 */

/**
 * Folds text for comparison: lower case, no accents, trimmed.
 *
 * @param text - As typed or as stored.
 * @returns The folded text.
 */
export function foldForSearch(text: string): string {
  return text.normalize('NFD').replaceAll(/\p{M}/gu, '').toLowerCase().trim();
}

/**
 * Splits a query into the words that must all be found.
 *
 * @param query - As typed.
 * @returns The folded words; none for a blank query.
 */
export function queryWords(query: string): string[] {
  return foldForSearch(query)
    .split(/\s+/u)
    .filter((word) => word !== '');
}

/**
 * Whether a set of fields answers a query.
 *
 * @param fields - What the row can be found by; nulls and blanks are skipped.
 * @param query - As typed.
 * @returns True for a blank query, and when every word is inside at least one field.
 */
export function matchesQuery(
  fields: readonly (string | null | undefined)[],
  query: string,
): boolean {
  const words = queryWords(query);

  if (words.length === 0) {
    return true;
  }

  const folded = fields.flatMap((field) =>
    field === null || field === undefined || field === '' ? [] : [foldForSearch(field)],
  );

  return words.every((word) => folded.some((field) => field.includes(word)));
}
