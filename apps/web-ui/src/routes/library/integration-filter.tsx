/**
 * The Filter button in the integrations header, and the small sheet it opens.
 *
 * Two facets - the wire and the internet - each a segmented control, in a sheet anchored under
 * the button rather than a row of controls beside the search: the grid is the point of the
 * page, and two controls that are used once a month should not take a line of it every day.
 * The button says how many facets are set, so a narrowed grid is never a mystery.
 *
 * Shut by Escape, by a click anywhere else, and by the button again.
 */
import { useEffect, useId, useRef, useState } from 'react';

import { Button, Segmented, cn, type SegmentedOption } from '@nebula-home/ui';

import { FilterIcon } from '@/components/icons';
import type { InternetFilter, TransportFilter, VendorFilter } from '@/library/vendor-filters';

/** The wires a vendor may be narrowed to. */
const WIRES: readonly SegmentedOption<TransportFilter>[] = [
  { value: '', label: 'Any' },
  { value: 'http', label: 'HTTP' },
  { value: 'mqtt', label: 'MQTT' },
];

/** The internet facet's choices. */
const INTERNET: readonly SegmentedOption<InternetFilter>[] = [
  { value: '', label: 'Any' },
  { value: 'local', label: 'Local only' },
  { value: 'needed', label: 'Needs it' },
];

/** What the filter needs. */
export type IntegrationFilterProps = {
  readonly filter: VendorFilter;

  /** Called with the filter as it now stands. */
  readonly onChange: (filter: VendorFilter) => void;
};

/**
 * Renders the button and its sheet.
 *
 * @param props - See {@link IntegrationFilterProps}.
 * @returns The control.
 */
export function IntegrationFilter(props: IntegrationFilterProps) {
  const { filter, onChange } = props;
  const [isOpen, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const sheetId = useId();
  const set = Number(filter.transport !== '') + Number(filter.internet !== '');

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    /**
     * Shuts the sheet on a click that lands outside it.
     *
     * @param event - The click.
     */
    const onPointerDown = (event: PointerEvent): void => {
      if (root.current !== null && !root.current.contains(event.target as Node)) {
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
        className={cn(set > 0 ? 'text-primary' : undefined)}
        onClick={() => {
          setOpen((current) => !current);
        }}
      >
        <FilterIcon width="15" height="15" />
        <span>Filter</span>
        {set > 0 ? (
          <span className="rounded-full bg-primary/15 px-1.5 text-label tabular">{set}</span>
        ) : null}
      </Button>

      {isOpen ? (
        <div
          id={sheetId}
          role="group"
          aria-label="Narrow the integrations"
          className={cn(
            'absolute top-full right-0 z-40 mt-2 flex w-72 flex-col gap-4 rounded-field border',
            'animate-rise border-border-strong face-card p-4 shadow-dialog',
          )}
        >
          <div className="flex flex-col gap-2">
            <span className="text-label text-foreground-subtle uppercase">Wire</span>
            <Segmented
              label="Wire"
              size="compact"
              options={WIRES}
              value={filter.transport}
              onChange={(transport) => {
                onChange({ ...filter, transport });
              }}
            />
          </div>
          <div className="flex flex-col gap-2">
            <span className="text-label text-foreground-subtle uppercase">Internet</span>
            <Segmented
              label="Internet"
              size="compact"
              options={INTERNET}
              value={filter.internet}
              onChange={(internet) => {
                onChange({ ...filter, internet });
              }}
            />
          </div>

          {set > 0 ? (
            <Button
              variant="ghost"
              size="compact"
              className="self-start"
              onClick={() => {
                onChange({ ...filter, transport: '', internet: '' });
              }}
            >
              Clear
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
