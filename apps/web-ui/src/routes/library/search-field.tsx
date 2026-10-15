/**
 * The search box every list in the interface has, in one shape.
 *
 * It was the same `TextField` copied onto five pages, each with its own width and nothing to
 * clear it with but the browser's own cross - which Firefox does not draw. Now there is one: a
 * magnifier in front so it reads as a search before anything is typed, a cross once something
 * has been, and Escape to clear it from the keyboard. What a list matches on is the list's
 * business; how the box behaves is this one's.
 */
import { useTranslation } from 'react-i18next';

import { AppIcon, cn, controlFace, FieldShell, IconButton } from '@nebulahome/ui';

/** What the box needs. */
export type SearchFieldProps = {
  /** What is typed. */
  readonly value: string;

  /** Called with what is typed now. */
  readonly onChange: (value: string) => void;

  /** What the box searches, as a hint inside it: "Search devices, entities…". */
  readonly placeholder: string;

  /** What it is called to a screen reader; "Search" unless said otherwise. */
  readonly label?: string;

  /** Anything extra for the outer element, such as a width. */
  readonly className?: string;
};

/**
 * Renders the search box.
 *
 * @param props - See {@link SearchFieldProps}.
 * @returns The box.
 */
export function SearchField(props: SearchFieldProps) {
  const { t } = useTranslation();

  const { value, onChange, placeholder, label = 'Search', className } = props;

  return (
    <FieldShell label={label} isLabelHidden className={cn('w-44 lg:w-72', className)}>
      {(ids) => (
        <div className="relative">
          <AppIcon
            id="search"
            size={14}
            className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-foreground-subtle"
          />
          <input
            id={ids.id}
            type="search"
            value={value}
            placeholder={placeholder}
            autoComplete="off"
            aria-describedby={ids.describedBy}
            className={cn(
              controlFace({ size: 'compact' }),
              // A search is a pill on the page's own ground, as tall as the buttons beside it. The
              // browser's own cross is hidden: this box draws one that every browser shows.
              'h-control rounded-pill bg-surface pr-8 pl-8.5 text-ui [&::-webkit-search-cancel-button]:appearance-none',
            )}
            onChange={(event) => {
              onChange(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape' && value !== '') {
                // Clearing is what Escape does here; a dialog around the box keeps its own.
                event.stopPropagation();
                onChange('');
              }
            }}
          />
          {value === '' ? null : (
            <IconButton
              size="small"
              label={t('library.searchField.clearTheSearch', 'Clear the search')}
              className="absolute top-1/2 right-1.5 size-6 -translate-y-1/2"
              onClick={() => {
                onChange('');
              }}
            >
              <AppIcon id="x" size={12} />
            </IconButton>
          )}
        </div>
      )}
    </FieldShell>
  );
}
