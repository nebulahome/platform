/**
 * A device's icon, drawn from the catalogue.
 *
 * A device carries an icon id and nothing else about it; what the id draws is the catalogue's
 * answer, read once for every icon a page shows - one request for the rows on screen, cached
 * by the set of ids - so that changing what `printer` looks like in Settings changes every
 * printer on the next visit without a device ever being touched.
 */
import { useQuery } from '@tanstack/react-query';

import type { DeviceView, IconView } from '@nebula-home/contracts';
import { CatalogueIcon, cn } from '@nebula-home/ui';

import { fetchIcons, LIBRARY_QUERY_KEYS } from '@/library/api';

/** The catalogue's answer for the icons some devices carry, by id. */
export type DeviceIcons = ReadonlyMap<string, IconView>;

/**
 * Reads the icons a list of devices shows.
 *
 * @param devices - The devices on screen.
 * @returns The icons by id; empty until read, and for a device without one.
 */
export function useDeviceIcons(devices: readonly Pick<DeviceView, 'icon'>[]): DeviceIcons {
  const ids = [...new Set(devices.flatMap((device) => (device.icon === null ? [] : [device.icon])))]
    .sort()
    .slice(0, 200);

  const query = useQuery({
    queryKey: [...LIBRARY_QUERY_KEYS.icons, 'ids', ids.join(',')],
    /**
     * Reads the icons of the devices on screen.
     *
     * @param context - What TanStack Query provides, including the cancellation signal.
     * @param context.signal - Cancels the request when the page goes away.
     * @returns The icons, by id.
     */
    queryFn: async ({ signal }: { signal: AbortSignal }) =>
      new Map((await fetchIcons({ ids }, signal)).map((icon) => [icon.id, icon])),
    enabled: ids.length > 0,
    staleTime: 60_000,
  });

  return query.data ?? new Map();
}

/** What drawing a device's icon needs. */
export type DeviceIconProps = {
  /** The catalogue's icon, or undefined while it is being read or when the device has none. */
  readonly icon: IconView | undefined;
  readonly size?: number;
  readonly className?: string;
};

/**
 * Draws a device's icon, or the space it would take.
 *
 * The space rather than nothing, so a list does not shift when the catalogue answers, and a
 * device without an icon lines up with the ones that have one.
 *
 * @param props - See {@link DeviceIconProps}.
 * @returns The icon, or its placeholder.
 */
export function DeviceIcon(props: DeviceIconProps) {
  const { icon, size = 20, className } = props;

  // An empty drawing takes exactly the space a full one would, in the same element.
  return (
    <CatalogueIcon
      node={icon?.node ?? []}
      frame={icon?.frame ?? { x: 0, y: 0, size: 24 }}
      size={size}
      className={cn(icon === undefined ? 'rounded-tile bg-surface-raised' : undefined, className)}
    />
  );
}
