/**
 * How a way into a device is drawn and named: the vendor's mark and name for its own transport,
 * the Matter mark and "Matter" for the Matter broker. The linked tag of a device or an entity
 * reached two ways is drawn from these.
 */
import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import {
  MATTER_TRANSPORT,
  type DeviceView,
  type EntityView,
  type IntegrationVendorView,
} from '@nebulahome/contracts';
import { LinkedTag } from '@nebulahome/ui';

import { MatterLogo } from '@/components/brand-logos';
import { fetchVendors, LIBRARY_QUERY_KEYS } from '@/library/api';
import { FALLBACK_COLOR } from '@/routes/library/vendor-card';

/** One way in, as a mark and a name draw it. */
export type TransportWay = { readonly vendorId: string; readonly transport: string };

/**
 * The integrations, read once for every mark on a page.
 *
 * @returns The integrations by id.
 */
export function useVendorsById(): ReadonlyMap<string, IntegrationVendorView> {
  const vendors = useQuery({
    queryKey: LIBRARY_QUERY_KEYS.vendors,

    /**
     * Reads the integrations.
     *
     * @param context - The query's abort signal.
     * @param context.signal - Cancels the request when the page goes away.
     * @returns The integrations.
     */
    queryFn: async ({ signal }) => fetchVendors(signal),
  });

  return new Map((vendors.data ?? []).map((vendor) => [vendor.id, vendor]));
}

/**
 * What a way in is called: "Matter" through the broker, else its integration's name.
 *
 * @param way - The way.
 * @param vendors - The integrations.
 * @param matter - What Matter is called.
 * @returns The name.
 */
export function wayName(
  way: TransportWay,
  vendors: ReadonlyMap<string, IntegrationVendorView>,
  matter: string,
): string {
  return way.transport === MATTER_TRANSPORT
    ? matter
    : (vendors.get(way.vendorId)?.name ?? way.vendorId);
}

/** What a transport's mark needs. */
export type TransportMarkProps = {
  readonly way: TransportWay;
  readonly vendors: ReadonlyMap<string, IntegrationVendorView>;

  /** The side of the square, in pixels. */
  readonly size?: number;
};

/**
 * One way in's mark: the vendor's logo or initial on a wash of its colour, or the Matter mark.
 *
 * @param props - See {@link TransportMarkProps}.
 * @returns The mark.
 */
export function TransportMark(props: TransportMarkProps) {
  const { way, vendors, size = 16 } = props;
  const vendor = vendors.get(way.vendorId);

  if (way.transport === MATTER_TRANSPORT || vendor === undefined) {
    return (
      <span
        aria-hidden="true"
        className="flex shrink-0 items-center justify-center rounded-check bg-violet/18 text-violet"
        /* eslint-disable-next-line react/forbid-dom-props -- the side is a value, per place. */
        style={{ width: size, height: size }}
      >
        <MatterLogo
          width={Math.max(10, Math.round(size * 0.625))}
          height={Math.max(10, Math.round(size * 0.625))}
        />
      </span>
    );
  }

  const color = vendor.color ?? FALLBACK_COLOR;

  return (
    <span
      aria-hidden="true"
      className="flex shrink-0 items-center justify-center overflow-hidden rounded-check leading-none font-bold"
      /* eslint-disable-next-line react/forbid-dom-props -- the side and the vendor's colour are
         values, per place and per vendor. */
      style={{
        width: size,
        height: size,
        color,
        backgroundColor: `color-mix(in srgb, ${color} 18%, transparent)`,
        fontSize: Math.max(11, Math.round(size * 0.69)),
      }}
    >
      {vendor.logo === undefined ? (
        vendor.name.charAt(0).toUpperCase()
      ) : (
        <img src={vendor.logo} alt="" width={size - 4} height={size - 4} className="block" />
      )}
    </span>
  );
}

/** What a device's or an entity's linked tag needs. */
export type WaysTagProps = {
  /** The ways in, the leading one first. */
  readonly ways: readonly TransportWay[];

  /** Whether the word Linked is written. */
  readonly isLabelled?: boolean;

  /** Unlinks, for a tag that offers it. */
  readonly onUnlink?: () => void;
};

/**
 * The linked tag of something reached more than one way.
 *
 * @param props - See {@link WaysTagProps}.
 * @returns The tag; nothing for one way in.
 */
export function WaysTag(props: WaysTagProps): ReactNode {
  const { t } = useTranslation();
  const { ways, isLabelled, onUnlink } = props;
  const vendors = useVendorsById();

  if (ways.length < 2) {
    return null;
  }

  const matter = t('library.matterTag', 'Matter');

  return (
    <LinkedTag
      marks={ways.map((way) => (
        <TransportMark
          key={`${way.vendorId}:${way.transport}`}
          way={way}
          vendors={vendors}
          size={isLabelled === true ? 16 : 14}
        />
      ))}
      transports={ways.map((way) => wayName(way, vendors, matter))}
      {...(isLabelled === undefined ? {} : { isLabelled })}
      {...(onUnlink === undefined ? {} : { onUnlink })}
    />
  );
}

/**
 * The ways into a device.
 *
 * @param device - The device.
 * @returns Its ways, its own first; one for a device reached one way.
 */
export function waysOfDevice(
  device: Pick<DeviceView, 'linked' | 'vendorId' | 'transport'>,
): TransportWay[] {
  return device.linked === null
    ? [{ vendorId: device.vendorId, transport: device.transport }]
    : device.linked.ways.map((way) => ({ vendorId: way.vendorId, transport: way.transport }));
}

/**
 * The ways an entity is read.
 *
 * @param entity - The entity.
 * @returns Its sources' ways; none for an entity read one way.
 */
export function waysOfEntity(entity: Pick<EntityView, 'linked'>): TransportWay[] {
  return (entity.linked?.sources ?? []).map((source) => ({
    vendorId: source.vendorId,
    transport: source.transport,
  }));
}
