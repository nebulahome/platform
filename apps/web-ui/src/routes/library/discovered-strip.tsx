/**
 * A vendor's devices found on the network, as a row above the devices already added.
 *
 * On the vendor's own page, between the vendor and its devices: a Shelly found on the network is
 * the Shelly page's business, and the owner reading that page is the one who adds it. Above the
 * list rather than in it, and set apart - a tinted, dashed box, the shape the interface gives
 * things that are not there yet - because a found device is something to do and an added one is
 * something to look at, and the two must not be mistaken for each other. One row, however many
 * there are - it scrolls sideways and snaps to a card - so the list below never moves down more
 * than one card's height. The arrows page through it for a pointer without a wheel; they appear
 * only when there is somewhere to page to.
 *
 * Nothing is drawn when nothing was found: an empty "Found on your network" is a promise the
 * network did not keep, every time the page opens.
 */
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';

import type { DiscoveredDevice, IntegrationVendorView } from '@nebulahome/contracts';
import { IconButton } from '@nebulahome/ui';

import { ChevronLeftIcon, ChevronRightIcon } from '@/components/icons';
import { DiscoveredCard } from '@/routes/library/discovered-card';
import { useMoveDevice } from '@/routes/library/use-move-device';

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

  /** A control on the heading's line, such as looking again. */
  readonly action?: ReactNode;
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
  const { t } = useTranslation();

  const { devices, vendors, canAdopt, onAdopt, action } = props;
  const headingId = useId();
  const mover = useMoveDevice();
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
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-3 rounded-panel border border-dashed border-primary/35 bg-primary/5 p-4"
    >
      <div className="flex items-center gap-2">
        <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-primary" />
        <h2 id={headingId} className="text-ui font-medium text-foreground">
          {t('library.discoveredStrip.foundOnYourNetwork', 'Found on your network')}
        </h2>
        <span className="text-ui text-foreground-subtle tabular">{devices.length}</span>
        <span className="grow" />
        {action}
        {isPaged ? (
          <span className="flex items-center gap-1">
            <IconButton
              variant="raised"
              size="small"
              label={t(
                'library.discoveredStrip.showThePreviousDevices',
                'Show the previous devices',
              )}
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
              label={t('library.discoveredStrip.showTheNextDevices', 'Show the next devices')}
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
            isMoving={mover.movingId === device.id}
            onMove={mover.move}
          />
        ))}
      </ul>

      {mover.problem === null ? null : (
        <p role="alert" className="text-ui text-danger">
          {mover.problem}
        </p>
      )}
    </section>
  );
}
