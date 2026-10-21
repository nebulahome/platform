/**
 * A device's, or an entity's, icon, drawn from the catalogue.
 *
 * A device carries an icon id and nothing else about it, and so does an entity; what the id
 * draws is the catalogue's answer, read once for every icon a page shows - one request for the
 * rows on screen, cached by the set of ids - so that changing what `printer` looks like in
 * Settings changes every printer on the next visit without a device ever being touched.
 */
import { useQuery } from '@tanstack/react-query';

import {
  MATTER_TRANSPORT,
  MATTER_VENDOR,
  MQTT_HOUSE_TRANSPORT,
  MQTT_VENDOR,
  type DeviceView,
  type IconView,
} from '@nebulahome/contracts';
import { CatalogueIcon, cn } from '@nebulahome/ui';

import { fetchIcons, fetchVendors, LIBRARY_QUERY_KEYS } from '@/library/api';
import { BROKER_GLYPHS } from '@/routes/library/brokers-page';
import { VendorLogo } from '@/routes/library/vendor-card';

/** The catalogue's answer for the icons some devices carry, by id. */
export type DeviceIcons = ReadonlyMap<string, IconView>;

/**
 * Reads the icons a page shows, by id.
 *
 * @param wanted - The icon ids on screen; nulls stand for rows without one and are skipped.
 * @returns The icons by id; empty until read.
 */
export function useCatalogueIcons(wanted: readonly (string | null)[]): DeviceIcons {
  const ids = [...new Set(wanted.flatMap((id) => (id === null ? [] : [id])))].sort().slice(0, 200);

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

/**
 * Reads the icons a list of devices shows.
 *
 * @param devices - The devices on screen.
 * @returns The icons by id; empty until read, and for a device without one.
 */
export function useDeviceIcons(devices: readonly Pick<DeviceView, 'icon'>[]): DeviceIcons {
  return useCatalogueIcons(devices.map((device) => device.icon));
}

/** What drawing a device's icon needs. */
export type DeviceIconProps = {
  /** The catalogue's icon, or undefined while it is being read or when the device has none. */
  readonly icon: IconView | undefined;
  readonly size?: number;
  readonly className?: string;

  /** The device, when it is one: a Matter device with no icon of its own shows whose it is. */
  readonly device?: Pick<DeviceView, 'icon' | 'transport' | 'vendorId'>;
};

/**
 * Whose a Matter or MQTT device is, for one with no icon of its own: its integration's logo, or
 * the broker's own mark for one the platform holds - bare, at the icon's size, since the place it
 * is drawn in already frames it.
 *
 * @param props - The device's vendor, its broker, the side and the caller's classes.
 * @param props.vendorId - The vendor.
 * @param props.broker - The broker it is reached through.
 * @param props.size - The side, in pixels.
 * @param props.className - The caller's classes, for the bare mark.
 * @returns The logo, or the mark.
 */
function BrokerOwnerMark(props: {
  readonly vendorId: string | null;
  readonly broker: 'matter' | 'mqtt';
  readonly size: number;
  readonly className: string | undefined;
}) {
  const { vendorId, broker, size, className } = props;
  const Mark = BROKER_GLYPHS[broker];
  const vendors = useQuery({
    queryKey: LIBRARY_QUERY_KEYS.vendors,

    /**
     * Reads the vendors, for the logo.
     *
     * @param context - The query's abort signal.
     * @param context.signal - Cancels the request when the page goes away.
     * @returns The vendors.
     */
    queryFn: async ({ signal }) => fetchVendors(signal),
  });
  const vendor = vendors.data?.find((each) => each.id === vendorId);

  return vendor === undefined || vendor.id === MATTER_VENDOR || vendor.id === MQTT_VENDOR ? (
    <Mark width={size} height={size} className={cn('shrink-0', className)} />
  ) : (
    <VendorLogo vendor={vendor} size={size} />
  );
}

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
  const { icon, size = 20, className, device } = props;

  if (device?.icon === null && device.transport === MATTER_TRANSPORT) {
    return (
      <BrokerOwnerMark
        vendorId={device.vendorId}
        broker="matter"
        size={size}
        className={className}
      />
    );
  }

  if (device?.icon === null && device.transport === MQTT_HOUSE_TRANSPORT) {
    return (
      <BrokerOwnerMark vendorId={device.vendorId} broker="mqtt" size={size} className={className} />
    );
  }

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
