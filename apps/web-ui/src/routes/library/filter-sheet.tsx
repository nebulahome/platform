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
 */
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

import { Button, cn } from '@nebula-home/ui';

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
  const { label, count, onClear, width = 'wide', children } = props;
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
        size="compact"
        aria-expanded={isOpen}
        aria-controls={sheetId}
        className={cn(count > 0 ? 'text-primary' : undefined)}
        onClick={() => {
          setOpen((current) => !current);
        }}
      >
        <FilterIcon width="15" height="15" />
        <span>Filter</span>
        {count > 0 ? (
          <span className="rounded-full bg-primary/15 px-1.5 text-label tabular">{count}</span>
        ) : null}
      </Button>

      {isOpen ? (
        <div
          id={sheetId}
          role="group"
          aria-label={label}
          className={cn(
            'absolute top-full right-0 z-40 mt-2 flex flex-col gap-4 rounded-field border',
            'animate-rise border-border-strong face-card p-4 shadow-dialog',
            width === 'wide' ? 'w-80' : 'w-72',
          )}
        >
          {children}

          {count > 0 ? (
            <Button variant="ghost" size="compact" className="self-start" onClick={onClear}>
              Clear
            </Button>
          ) : null}
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
 * @returns "Any" first, then the choices by group and name, with the chosen one if it was missing.
 */
export function facetChoices(
  options: readonly FacetOption[],
  chosen: string,
  anyLabel: string,
): FacetOption[] {
  const sorted = [...options].sort(
    (left, right) =>
      (left.group ?? '').localeCompare(right.group ?? '') || left.label.localeCompare(right.label),
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
};

/**
 * Frames one facet in the sheet: its title over its control.
 *
 * @param props - See {@link FacetProps}.
 * @returns The facet.
 */
export function Facet(props: FacetProps) {
  const { title, children } = props;

  return (
    <div className="flex flex-col gap-2">
      <span className="text-label text-foreground-subtle uppercase">{title}</span>
      {children}
    </div>
  );
}
