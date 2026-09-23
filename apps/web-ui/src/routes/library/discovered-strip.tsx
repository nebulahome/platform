/**
 * The devices found on the network, as a row above the vendors.
 *
 * Above rather than among them: a vendor card is somewhere to go, a found device is something to
 * do, and the owner opening this page with a new plug on the network should see it before the
 * catalogue. One row, however many there are - it scrolls sideways and snaps to a card - so the
 * grid below never moves down more than one card's height. The arrows page through it for a
 * pointer without a wheel; they appear only when there is somewhere to page to.
 *
 * Nothing is drawn when nothing was found: an empty "Found on your network" is a promise the
 * network did not keep, every time the page opens.
 */
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';

import type { DiscoveredDevice, IntegrationVendorView } from '@nebula-home/contracts';
import { IconButton } from '@nebula-home/ui';

import { ChevronLeftIcon, ChevronRightIcon } from '@/components/icons';
import { DiscoveredCard } from '@/routes/library/discovered-card';

/** How much of the row one arrow press moves by: most of a view, so a card stays in sight. */
const PAGE_FRACTION = 0.8;

/** What the row needs. */
export type DiscoveredStripProps = {
  readonly devices: readonly DiscoveredDevice[];

  /** The vendors, for each card's logo and name. */
  readonly vendors: readonly IntegrationVendorView[];

  /** Whether the person may add devices. */
  readonly canAdopt: boolean;

  /** Called with the device whose Adopt was pressed. */
  readonly onAdopt: (device: DiscoveredDevice) => void;
};

/** Where the row can be paged to from where it is. */
type Reach = { readonly canGoBack: boolean; readonly canGoOn: boolean };

/**
 * Reads where a row can be paged to.
 *
 * @param list - The row.
 * @returns Whether there is anything before and after what is in view.
 */
function reachOf(list: HTMLElement): Reach {
  return {
    canGoBack: list.scrollLeft > 1,
    canGoOn: list.scrollLeft + list.clientWidth < list.scrollWidth - 1,
  };
}

/**
 * Renders the row, or nothing when nothing was found.
 *
 * @param props - See {@link DiscoveredStripProps}.
 * @returns The row.
 */
export function DiscoveredStrip(props: DiscoveredStripProps) {
  const { devices, vendors, canAdopt, onAdopt } = props;
  const headingId = useId();
  const listRef = useRef<HTMLUListElement>(null);
  const [reach, setReach] = useState<Reach>({ canGoBack: false, canGoOn: false });

  /** Reads again where the row can be paged to. */
  const measure = useCallback((): void => {
    const list = listRef.current;

    if (list !== null) {
      const next = reachOf(list);

      setReach((current) =>
        current.canGoBack === next.canGoBack && current.canGoOn === next.canGoOn ? current : next,
      );
    }
  }, []);

  useLayoutEffect(measure, [measure, devices.length]);

  useEffect(() => {
    window.addEventListener('resize', measure);

    return (): void => {
      window.removeEventListener('resize', measure);
    };
  }, [measure]);

  if (devices.length === 0) {
    return null;
  }

  /**
   * Pages the row one way.
   *
   * @param direction - Back (-1) or on (1).
   */
  const page = (direction: -1 | 1): void => {
    const list = listRef.current;

    if (list !== null) {
      list.scrollBy({
        left: Math.round(direction * list.clientWidth * PAGE_FRACTION),
        behavior: 'smooth',
      });
    }
  };

  const isPaged = reach.canGoBack || reach.canGoOn;

  return (
    <section aria-labelledby={headingId} className="mb-8 flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <h2 id={headingId} className="text-ui font-medium text-foreground">
          Found on your network
        </h2>
        <span className="text-ui text-foreground-subtle tabular">{devices.length}</span>
        <span className="grow" />
        {isPaged ? (
          <span className="flex items-center gap-1">
            <IconButton
              variant="raised"
              size="small"
              label="Show the previous devices"
              disabled={!reach.canGoBack}
              onClick={() => {
                page(-1);
              }}
            >
              <ChevronLeftIcon width="15" height="15" />
            </IconButton>
            <IconButton
              variant="raised"
              size="small"
              label="Show the next devices"
              disabled={!reach.canGoOn}
              onClick={() => {
                page(1);
              }}
            >
              <ChevronRightIcon width="15" height="15" />
            </IconButton>
          </span>
        ) : null}
      </div>

      <ul
        ref={listRef}
        onScroll={measure}
        className="-mx-1 flex snap-x snap-mandatory gap-4 overflow-x-auto scroll-smooth px-1 pb-2"
      >
        {devices.map((device) => (
          <DiscoveredCard
            key={device.id}
            device={device}
            vendor={vendors.find((vendor) => vendor.id === device.vendorId)}
            canAdopt={canAdopt}
            onAdopt={onAdopt}
          />
        ))}
      </ul>
    </section>
  );
}
