/**
 * What a list says when its search and filters leave nothing.
 *
 * The same dashed outline the library draws for an empty collection, because it is the same
 * situation seen from the other side: nothing to show. It says what was searched for, and it
 * carries the one button the sentence used to only describe - clearing the search and every
 * filter together - so a person who narrowed too far is one press from the whole list. It is a
 * status, so a screen reader hears the list go empty as the typing does it.
 */
import { useTranslation } from 'react-i18next';

import { Button } from '@nebulahome/ui';

/** What the message needs. */
export type NoMatchesProps = {
  /** What was typed, when anything was. */
  readonly query: string;

  /** Called to clear the search and every filter; absent when there is nothing to clear. */
  readonly onClear?: (() => void) | undefined;
};

/**
 * Renders the message.
 *
 * @param props - See {@link NoMatchesProps}.
 * @returns The message.
 */
export function NoMatches(props: NoMatchesProps) {
  const { t } = useTranslation();

  const { query, onClear } = props;
  const trimmed = query.trim();

  return (
    <div
      role="status"
      className="flex flex-col items-center gap-3 rounded-panel border border-dashed border-border-strong px-6 py-8 text-center"
    >
      <p className="max-w-md text-ui text-foreground-muted">
        {trimmed === ''
          ? t('library.noMatches.nothingMatchesTheseFilters', 'Nothing matches these filters.')
          : t('library.noMatches.nothingMatchesTrimmed', 'Nothing matches “{{trimmed}}”.', {
              trimmed,
            })}
      </p>
      {onClear === undefined ? null : (
        <Button variant="ghost" size="compact" onClick={onClear}>
          {t('library.noMatches.clearSearchAndFilters', 'Clear search and filters')}
        </Button>
      )}
    </div>
  );
}
