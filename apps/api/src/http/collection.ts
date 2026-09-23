/**
 * The shape of a bounded collection: `{ items }` and nothing else.
 *
 * Areas, tags, devices and the like are bounded by what a house holds and are served whole
 * (API.md 3.3); the cursor pagination entities need would be ceremony on a list of nine.
 */
import { z } from 'zod';

/**
 * Wraps an item schema as a whole collection of them.
 *
 * @param item - The schema of one item.
 * @returns The schema of the collection.
 */
export const collectionSchema = <TItem extends z.ZodType>(
  item: TItem,
): z.ZodObject<{ items: z.ZodArray<TItem> }> => z.object({ items: z.array(item) });
