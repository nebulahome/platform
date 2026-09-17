/**
 * The Filter button in the devices header, and the small sheet it opens.
 *
 * Two facets - the vendor and the area - each a segmented control, in a sheet anchored under
 * the button rather than a row of controls beside the search: the table is the point of the
 * page, and two controls that are used once a month should not take a line of it every day.
 * The button says how many facets are set, so a narrowed table is never a mystery.
 *
 * Shut by Escape, by a click anywhere else, and by the button again.
 */
import { useEffect, useId, useRef, useState } from 'react';

import { Button, Segmented, cn, type SegmentedOption } from '@nebula-home/ui';

import { FilterIcon } from '@/components/icons';
import type { DeviceFilter } from '@/library/device-filters';

/** One thing a facet may be set to. */
export type FacetOption = {
  readonly value: string;
  readonly label: string;
};

/** What the filter needs. */
export type DeviceFilterButtonProps = {
  readonly filter: DeviceFilter;

  /** The vendors the devices belong to, by id, named the way the catalogue names them. */
  readonly vendors: readonly FacetOption[];

  /** The areas the devices are in, by key. */
  readonly areas: readonly FacetOption[];

  /** Called with the filter as it now stands. */
  readonly onChange: (filter: DeviceFilter) => void;
};

/**
 * Renders the button and its sheet.
 *
 * @param props - See {@link DeviceFilterButtonProps}.
 * @returns The control.
 */
export function DeviceFilterButton(props: DeviceFilterButtonProps) {
  const { filter, vendors, areas, onChange } = props;
  const [isOpen, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const sheetId = useId();
  const set = Number(filter.vendorId !== '') + Number(filter.areaKey !== '');

  const vendorOptions: readonly SegmentedOption<string>[] = [
    { value: '', label: 'Any vendor' },
    ...vendors,
  ];
  const areaOptions: readonly SegmentedOption<string>[] = [
    { value: '', label: 'Any area' },
    ...areas,
  ];

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
          aria-label="Narrow the devices"
          className={cn(
            'absolute top-full right-0 z-40 mt-2 flex w-80 flex-col gap-4 rounded-field border',
            'animate-rise border-border-strong face-card p-4 shadow-dialog',
          )}
        >
          <div className="flex flex-col gap-2">
            <span className="text-label text-foreground-subtle uppercase">Integration</span>
            <Segmented
              label="Integration"
              size="compact"
              options={vendorOptions}
              value={filter.vendorId}
              onChange={(vendorId) => {
                onChange({ ...filter, vendorId });
              }}
            />
          </div>
          <div className="flex flex-col gap-2">
            <span className="text-label text-foreground-subtle uppercase">Area</span>
            {areas.length === 0 ? (
              <span className="text-caption text-foreground-subtle">
                No device has an area yet.
              </span>
            ) : (
              <Segmented
                label="Area"
                size="compact"
                options={areaOptions}
                value={filter.areaKey}
                onChange={(areaKey) => {
                  onChange({ ...filter, areaKey });
                }}
              />
            )}
          </div>

          {set > 0 ? (
            <Button
              variant="ghost"
              size="compact"
              className="self-start"
              onClick={() => {
                onChange({ ...filter, vendorId: '', areaKey: '' });
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
