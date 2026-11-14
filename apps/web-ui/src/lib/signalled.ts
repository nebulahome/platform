/**
 * A query's read from a function that takes nothing but the abort signal - what most of the
 * interface's fetches are - so a query says `queryFn: signalled(fetchDevices)`.
 */

/**
 * Wraps a read as a query function.
 *
 * @param read - Reads the data; the signal cancels the request when the query is dropped.
 * @returns The query function, which hands it the query's signal.
 */
export function signalled<TData>(
  read: (signal: AbortSignal) => Promise<TData>,
): (context: { readonly signal: AbortSignal }) => Promise<TData> {
  return async ({ signal }) => read(signal);
}
