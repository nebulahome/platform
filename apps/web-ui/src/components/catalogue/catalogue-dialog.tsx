/**
 * The install dialog's frame: one modal with two pages, shared by packages and integrations.
 *
 * The first page is the search across the whole dialog and its results as full-width rows; the
 * second is the picked item's own page, with "‹ Results" back and its install at the foot. No
 * categories and no foot on the first page: a search, and what it found. The frame draws the two
 * pages and nothing about what is listed - the rows and the item's page are the caller's, its data
 * the hooks'.
 */
import { useId, type ReactNode } from 'react';

import { AppIcon, Button, Modal, type UiIconId } from '@nebulahome/ui';

/** The item open on the second page. */
export type CatalogueDialogItem = {
  /** Its name, the page's title. */
  readonly name: string;

  /** What the way back is called: "Results", "Packages". */
  readonly backLabel: string;

  /** Called to go back to the results. */
  readonly onBack: () => void;
};

/** What the frame needs. */
export type CatalogueDialogProps = {
  readonly isOpen: boolean;

  /** Called to close it; not while an install is under way. */
  readonly onClose: () => void;

  /** The first page's title: "Install an integration". */
  readonly title: string;

  /** The line under it: where the results come from. */
  readonly subtitle: string;

  /** The glyph in the first page's well. */
  readonly icon: UiIconId;

  /** The item open on the second page; null on the first. */
  readonly item: CatalogueDialogItem | null;

  /** What is typed in the search. */
  readonly search: string;

  /** Called as the owner types. */
  readonly onSearch: (search: string) => void;

  /** What the search is called, to a screen reader. */
  readonly searchLabel: string;

  /** Its placeholder. */
  readonly searchPlaceholder: string;

  /** Under the search: how many were found, or why the Hub could not be asked. */
  readonly status?: ReactNode;

  /** The page: the results, or the item. */
  readonly children: ReactNode;

  /** The second page's foot: the link out, Cancel and Install. */
  readonly footer?: ReactNode;
};

/**
 * Renders the dialog's frame.
 *
 * @param props - See {@link CatalogueDialogProps}.
 * @returns The dialog.
 */
export function CatalogueDialog(props: CatalogueDialogProps) {
  const {
    isOpen,
    onClose,
    title,
    subtitle,
    icon,
    item,
    search,
    onSearch,
    searchLabel,
    searchPlaceholder,
    status,
    children,
    footer,
  } = props;
  const searchId = useId();

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      size="xlarge"
      layout="sections"
      title={item === null ? title : item.name}
      {...(item === null ? { description: subtitle } : {})}
      lead={
        item === null ? (
          <span
            aria-hidden="true"
            className="flex size-11 shrink-0 items-center justify-center rounded-tile border border-border-strong bg-surface-raised text-primary"
          >
            <AppIcon id={icon} size={20} />
          </span>
        ) : (
          <Button variant="ghost" size="compact" className="pl-2" onClick={item.onBack}>
            <AppIcon id="chevron-left" size={15} />
            {item.backLabel}
          </Button>
        )
      }
      {...(item === null || footer === undefined ? {} : { footer })}
    >
      {item === null ? (
        <div className="flex flex-col gap-3 px-6 pt-5 pb-6">
          <label htmlFor={searchId} className="sr-only">
            {searchLabel}
          </label>
          <div className="relative">
            <AppIcon
              id="search"
              size={17}
              className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-foreground-subtle"
            />
            <input
              id={searchId}
              type="search"
              value={search}
              placeholder={searchPlaceholder}
              autoComplete="off"
              // eslint-disable-next-line jsx-a11y/no-autofocus -- the dialog is a search: typing is what it is opened for
              autoFocus
              className="h-control-lg w-full rounded-pill border border-border-strong bg-canvas pr-16 pl-11 text-title text-foreground transition placeholder:text-foreground-subtle focus-visible:border-primary focus-visible:shadow-focus focus-visible:outline-none [&::-webkit-search-cancel-button]:appearance-none"
              onChange={(event) => {
                onSearch(event.target.value);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Escape' && search !== '') {
                  // Clearing is what Escape does while there is a search; then it closes.
                  event.stopPropagation();
                  onSearch('');
                }
              }}
            />
            {/* The key's name, as it is printed on the key. */}
            <kbd
              aria-hidden="true"
              translate="no"
              className="pointer-events-none absolute top-1/2 right-3.5 -translate-y-1/2 rounded-chip border border-border-strong px-1.5 font-mono text-label text-foreground-subtle"
            >
              Esc
            </kbd>
          </div>

          {status === undefined ? null : (
            <div className="px-1 text-caption text-foreground-subtle">{status}</div>
          )}

          {children}
        </div>
      ) : (
        children
      )}
    </Modal>
  );
}
