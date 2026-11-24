/**
 * What a list says when its search and filters leave nothing.
 *
 * The same dashed outline the library draws for an empty collection, because it is the same
 * situation seen from the other side: nothing to show. It says what was searched for, and it
 * carries the one button the sentence used to only describe - clearing the search and every
 * filter together - so a person who narrowed too far is one press from the whole list. It is a
 * status, so a screen reader hears the list go empty as the typing does it.
 *
 * Inside a panel (`isInPanel`) the panel is the outline: no dashes, the search's glyph over the
 * sentence instead, and room around it - an integration's Devices tab draws it so.
 */
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { AppIcon, Button, cn } from '@nebulahome/ui';

/** What the message needs. */
export type NoMatchesProps = {
  /** What was typed, when anything was. */
  readonly query: string;

  /** Called to clear the search and every filter; absent when there is nothing to clear. */
  readonly onClear?: (() => void) | undefined;

  /** Under the sentence: what the search looks at. */
  readonly hint?: string;

  /** Under the button: where else to look. */
  readonly footer?: ReactNode;

  /** Drawn inside a panel, which is its outline. */
  readonly isInPanel?: boolean;
};

/**
 * Renders the message.
 *
 * @param props - See {@link NoMatchesProps}.
 * @returns The message.
 */
export function NoMatches(props: NoMatchesProps) {
  const { t } = useTranslation();

  const { query, onClear, hint, footer, isInPanel = false } = props;
  const trimmed = query.trim();

  return (
    <div
      role="status"
      className={cn(
        'flex flex-col items-center gap-3 text-center',
        isInPanel
          ? 'px-6 pt-14 pb-16'
          : 'rounded-panel border border-dashed border-border-strong px-6 py-8',
      )}
    >
      {isInPanel ? (
        <span
          aria-hidden="true"
          className="mb-1 flex size-13 items-center justify-center rounded-card border border-border-strong bg-surface-raised text-foreground-muted"
        >
          <AppIcon id="search-x" size={22} />
        </span>
      ) : null}
      <p
        className={cn(
          'max-w-md',
          isInPanel ? 'text-subhead font-medium text-foreground' : 'text-ui text-foreground-muted',
        )}
      >
        {trimmed === ''
          ? t('library.noMatches.nothingMatchesTheseFilters', 'Nothing matches these filters.')
          : t('library.noMatches.nothingMatchesTrimmed', 'Nothing matches “{{trimmed}}”.', {
              trimmed,
            })}
      </p>
      {hint === undefined || trimmed === '' ? null : (
        <p className="-mt-1.5 max-w-md text-ui-sm text-foreground-muted">{hint}</p>
      )}
      {onClear === undefined ? null : (
        <Button variant="ghost" size="compact" onClick={onClear}>
          {t('library.noMatches.clearSearchAndFilters', 'Clear search and filters')}
        </Button>
      )}
      {footer === undefined ? null : (
        <p className="mt-2 max-w-md text-ui-sm text-foreground-subtle">{footer}</p>
      )}
    </div>
  );
}
