/**
 * Marking where a query matched inside a result's title: the settings search and the command
 * palette both do it, each with its own look for the mark.
 */
import type { ReactNode } from 'react';

import { foldForSearch } from '@/lib/search-text';

/**
 * Marks where each of the words sits in a title, the first place each is found.
 *
 * Folding never changes a string's length for the letters a title is written in, so a place found
 * in the folded copy is the place in the original; a title it would change is left unmarked.
 *
 * @param title - The title.
 * @param words - What to mark, folded (`foldForSearch`); blanks are skipped.
 * @param className - The mark's classes.
 * @returns The title, with the matches marked.
 */
export function markMatch(title: string, words: readonly string[], className: string): ReactNode {
  const folded = foldForSearch(title);

  if (folded.length !== title.length) {
    return title;
  }

  const spans = words
    .filter((word) => word !== '')
    .flatMap((word) => {
      const at = folded.indexOf(word);

      return at < 0 ? [] : [[at, at + word.length] as const];
    })
    .toSorted((a, b) => a[0] - b[0]);

  if (spans.length === 0) {
    return title;
  }

  // Overlapping words ("light", "lights") join into one mark.
  const merged: [number, number][] = [];

  for (const [from, to] of spans) {
    const last = merged.at(-1);

    if (last !== undefined && from <= last[1]) {
      last[1] = Math.max(last[1], to);
    } else {
      merged.push([from, to]);
    }
  }

  const parts: ReactNode[] = [];
  let at = 0;

  for (const [from, to] of merged) {
    parts.push(
      title.slice(at, from),
      <mark key={from} className={className}>
        {title.slice(from, to)}
      </mark>,
    );
    at = to;
  }

  parts.push(title.slice(at));

  return parts;
}
