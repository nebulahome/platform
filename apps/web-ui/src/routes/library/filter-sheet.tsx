/**
 * The Filter button in a library page's header, and the small sheet it opens.
 *
 * One shell for every page that narrows a list by a facet or two: the facets sit in a sheet
 * anchored under the button rather than in a row beside the search, because the list is the
 * point of the page and controls used once a month should not take a line of it every day.
 * The button says how many facets are set, so a narrowed list is never a mystery, and offers
 * to clear them when any is.
 *
 * Shut by Escape, by a press anywhere else, and by the button again - where "anywhere else"
 * leaves alone the list a dropdown inside the sheet has portalled out of it.
 *
 * Drawn as the boards' Filters panel: a head with Reset, each facet a section under a line, and
 * a foot saying how many of how many the list shows - applied as they are chosen, no Apply.
 */
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

import { Button, cn } from '@nebulahome/ui';

import { FilterIcon } from '@/components/icons';
import { isOwnedListbox } from '@/lib/owned-listbox';

/** What the shell needs. */
export type FilterSheetProps = {
  /** What the sheet narrows, for a reader: "Narrow the devices". */
  readonly label: string;

  /** How many facets are set. */
  readonly count: number;

  /** Called to unset every facet. */
  readonly onClear: () => void;

  /** How wide the sheet is; `wide` unless said otherwise, so every page's sheet is one shape. */
  readonly width?: 'medium' | 'wide';

  /** The foot's count: "4 of 9 shown". */
  readonly summary?: ReactNode;

  /** The facets. */
  readonly children: ReactNode;
};

/**
 * Renders the button and its sheet.
 *
 * @param props - See {@link FilterSheetProps}.
 * @returns The control.
 */
export function FilterSheet(props: FilterSheetProps) {
  const { label, count, onClear, width = 'wide', summary, children } = props;
  const [isOpen, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const sheetId = useId();

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    /**
     * Shuts the sheet on a press that lands outside it, and outside any list it opened.
     *
     * @param event - The press.
     */
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target instanceof Node ? event.target : null;

      if (
        root.current !== null &&
        target !== null &&
        !root.current.contains(target) &&
        !isOwnedListbox(root.current, target)
      ) {
        setOpen(false);
      }
    };

    /**
     * Shuts the sheet on Escape.
     *
     * @param event - The key.
     */
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };

    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);

    return (): void => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [isOpen]);

  return (
    <div ref={root} className="relative">
      <Button
        variant="ghost"
        size="medium"
        aria-expanded={isOpen}
        aria-controls={sheetId}
        className={cn(count > 0 ? 'border-primary bg-primary-soft text-primary' : undefined)}
        onClick={() => {
          setOpen((current) => !current);
        }}
      >
        <FilterIcon width="15" height="15" />
        <span>Filter</span>
        {count > 0 ? (
          <span className="rounded-pill bg-primary/15 px-1.5 font-mono text-label tabular">
            {count}
          </span>
        ) : null}
      </Button>

      {isOpen ? (
        <div
          id={sheetId}
          role="group"
          aria-label={label}
          className={cn(
            'absolute top-full right-0 z-40 mt-2 flex flex-col rounded-card border',
            'animate-rise border-border-strong bg-surface shadow-float',
            width === 'wide' ? 'w-85' : 'w-72',
          )}
        >
          <div className="flex items-center justify-between gap-3 px-6 pt-4.5 pb-3">
            <span className="text-title font-medium text-foreground">Filters</span>
            {count > 0 ? (
              <button
                type="button"
                onClick={onClear}
                className="rounded-chip text-ui-sm text-primary transition-colors hover:text-primary-hover"
              >
                Reset
              </button>
            ) : null}
          </div>

          {children}

          {summary === undefined ? null : (
            <div className="flex items-center justify-between gap-3 border-t border-border px-6 py-3 text-caption text-foreground-subtle">
              <span>{summary}</span>
              <span>Applied as you choose</span>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

/** One choice of a facet's dropdown. */
export type FacetOption = {
  readonly value: string;
  readonly label: string;

  /** The heading it is listed under, such as a room's floor. */
  readonly group?: string;
};

/**
 * A facet's choices, with the chosen one kept even when the data no longer offers it.
 *
 * A facet built from the loaded data - the vendors present, the rooms devices are in - loses a
 * value the moment the last row carrying it goes; the dropdown then showed a blank choice while
 * the badge still counted the filter, and the list stayed narrowed by something nobody could
 * see. The chosen value stays listed, named as it was, until it is cleared.
 *
 * @param options - The choices the data offers, in order.
 * @param chosen - The value chosen now; blank for any.
 * @param anyLabel - What the "any" choice is called.
 * @param isOrdered - Whether the options already come in the order to show them - the areas, by
 * floor number - rather than to be sorted by group and name.
 * @returns "Any" first, then the choices, with the chosen one if it was missing.
 */
export function facetChoices(
  options: readonly FacetOption[],
  chosen: string,
  anyLabel: string,
  isOrdered = false,
): FacetOption[] {
  const sorted = isOrdered
    ? [...options]
    : [...options].sort(
        (left, right) =>
          (left.group ?? '').localeCompare(right.group ?? '') ||
          left.label.localeCompare(right.label),
      );
  const isMissing = chosen !== '' && !sorted.some((option) => option.value === chosen);

  return [
    { value: '', label: anyLabel },
    ...sorted,
    ...(isMissing ? [{ value: chosen, label: `${chosen} (gone)` }] : []),
  ];
}

/** What one facet's frame needs. */
export type FacetProps = {
  /** What the facet is called, drawn in small capitals over the control. */
  readonly title: string;

  /** The control. */
  readonly children: ReactNode;

  /** On the right of the heading: "2 selected". */
  readonly aside?: ReactNode;
};

/**
 * Frames one facet in the sheet: its title over its control.
 *
 * @param props - See {@link FacetProps}.
 * @returns The facet.
 */
export function Facet(props: FacetProps) {
  const { title, aside, children } = props;

  return (
    <div className="flex flex-col gap-2.5 border-t border-border px-6 py-4">
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-mono text-label text-foreground-subtle uppercase">{title}</span>
        {aside === undefined ? null : (
          <span className="text-caption text-foreground-subtle">{aside}</span>
        )}
      </div>
      {children}
    </div>
  );
}
