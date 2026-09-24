/**
 * A list's search and filters, kept in the address.
 *
 * They used to live in the page's state, so opening an alias to change it and coming back lost
 * the search that found it, and a narrowed list could not be linked to. In the query string they
 * survive both: the back button returns to the list as it was left, and a link carries it.
 *
 * Each page describes its own filter with a {@link ListCodec}: how to read it from the query and
 * how to write it back, leaving out whatever is at its default so a list opened plain has a
 * plain address. Changes replace the entry rather than pushing one - typing a search is not
 * something the back button should step through a letter at a time.
 */
import { useSearchParams } from 'react-router';

/** How one page's filter lives in the address. */
export type ListCodec<TFilter> = {
  /**
   * Reads the filter from the query.
   *
   * @param params - The query as it stands.
   * @returns The filter, with defaults for what is absent or does not read.
   */
  readonly read: (params: URLSearchParams) => TFilter;

  /**
   * The filter as query entries, leaving out what is at its default.
   *
   * @param filter - The filter.
   * @returns The entries, by key.
   */
  readonly write: (filter: TFilter) => Readonly<Record<string, string>>;

  /** Every key the filter owns, so writing one filter clears what an older one left. */
  readonly keys: readonly string[];
};

/**
 * Reads and writes a list's filter through the address.
 *
 * @param codec - How the page's filter lives in the query.
 * @returns The filter, and the function that replaces it.
 */
export function useListState<TFilter>(
  codec: ListCodec<TFilter>,
): readonly [TFilter, (next: TFilter) => void] {
  const [params, setParams] = useSearchParams();

  /**
   * Replaces the filter in the address.
   *
   * @param next - The filter as it should stand.
   */
  const set = (next: TFilter): void => {
    setParams(
      (current) => {
        const updated = new URLSearchParams(current);

        for (const key of codec.keys) {
          updated.delete(key);
        }

        for (const [key, value] of Object.entries(codec.write(next))) {
          updated.set(key, value);
        }

        return updated;
      },
      { replace: true },
    );
  };

  return [codec.read(params), set];
}

/**
 * Reads one of a fixed set of values from the query.
 *
 * @param params - The query.
 * @param key - The entry.
 * @param choices - The values it may hold.
 * @param fallback - What an absent or unknown value reads as.
 * @returns The value.
 */
export function readChoice<TValue extends string>(
  params: URLSearchParams,
  key: string,
  choices: readonly TValue[],
  fallback: TValue,
): TValue {
  const value = params.get(key);

  return choices.find((choice) => choice === value) ?? fallback;
}

/**
 * Query entries for the values that differ from their defaults.
 *
 * @param entries - Each key with its value and its default.
 * @returns The entries whose value is not the default.
 */
export function nonDefault(
  entries: Readonly<Record<string, readonly [value: string, fallback: string]>>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(entries).flatMap(([key, [value, fallback]]) =>
      value === fallback ? [] : [[key, value]],
    ),
  );
}
