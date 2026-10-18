/**
 * One vendor in the grid: who they are, what wire they speak, and what has come in through them.
 *
 * Small on purpose - seven of these should fit above the fold with room left - and built from
 * three lines of type in three sizes: the name in the foreground, the version subtle beneath it,
 * the counts muted at the foot with their figures pulled forward. The logo takes the top left;
 * the marks take the top right, icons rather than words, because "http" on every fourth card is
 * noise once you know what it means and a globe says "needs the internet" faster than the phrase.
 * Each word survives as a tooltip for the first time you meet it.
 *
 * A vendor without a logo gets a monogram in its own colour, the same size and in the same
 * place, so the grid stays even whatever the bundles shipped with.
 *
 * When the hub has found devices of the vendor that nobody has added, the card says how many, in
 * the tint the vendor's page draws them in: that page is where they are adopted.
 *
 * As the boards draw it, the foot is parted by a line: how the vendor stands as a Pill - Running,
 * Degraded, Needs sign-in, Idle - and what has come in through it. The wires are its page's.
 */
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import type { IntegrationVendorView } from '@nebulahome/contracts';
import { AppIcon, Pill, Tile, TILE_FRAME, TileMark } from '@nebulahome/ui';

import {
  BluetoothIcon,
  GlobeIcon,
  HttpIcon,
  MatterIcon,
  ModbusIcon,
  MqttIcon,
  UdpIcon,
  ZigbeeIcon,
  type IconProps,
} from '@/components/icons';
import { defineMessage, type Message, text } from '@/i18n/messages';
import { wiresOf, type Wire } from '@/library/vendor-filters';
import { vendorStatusOf } from '@/library/vendor-status';

/** The colour a vendor without one of its own is drawn in: the accent. */
const FALLBACK_COLOR = 'var(--color-primary)';

/** A glyph, as the icon set draws one. */
type Glyph = (props: IconProps) => React.ReactNode;

/** What each wire is drawn as, and what the tooltip says. */
const WIRES: Readonly<Record<Wire, { readonly glyph: Glyph; readonly title: Message }>> = {
  http: {
    glyph: HttpIcon,
    title: defineMessage('library.vendorCard.speaksHttpToEach', 'Speaks HTTP to each device'),
  },
  mqtt: {
    glyph: MqttIcon,
    title: defineMessage('library.vendorCard.listensOnTheMqtt', 'Listens on the MQTT broker'),
  },
  ble: {
    glyph: BluetoothIcon,
    title: defineMessage(
      'library.vendorCard.reachesItsDevicesOver',
      'Reaches its devices over Bluetooth LE',
    ),
  },
  zigbee: {
    glyph: ZigbeeIcon,
    title: defineMessage(
      'library.vendorCard.reachesItsDevicesOver2',
      'Reaches its devices over Zigbee',
    ),
  },
  udp: {
    glyph: UdpIcon,
    title: defineMessage(
      'library.vendorCard.speaksToEachDevice',
      'Speaks to each device in its own datagrams on the network',
    ),
  },
  modbus: {
    glyph: ModbusIcon,
    title: defineMessage(
      'library.vendorCard.readsItsDevicesOver',
      'Reads its devices over Modbus TCP',
    ),
  },
  matter: {
    glyph: MatterIcon,
    title: defineMessage(
      'library.vendorCard.reachesItsDevicesOverMatter',
      "Reaches its devices over the house's Matter fabric",
    ),
  },
};

/** What a mark needs. */
type MarkProps = {
  readonly title: string;
  readonly glyph: Glyph;

  /** A warning worth a colour, rather than a neutral fact. */
  readonly tone?: 'neutral' | 'warning';
  readonly size?: 'small' | 'medium';
};

/**
 * One round, icon-only fact.
 *
 * @param props - See {@link MarkProps}.
 * @returns The mark.
 */
export function Mark(props: MarkProps) {
  const { title, glyph: Icon, tone = 'neutral', size = 'small' } = props;

  return (
    <TileMark title={title} tone={tone} className={size === 'small' ? undefined : 'size-7'}>
      <Icon width={size === 'small' ? 13 : 14} height={size === 'small' ? 13 : 14} />
    </TileMark>
  );
}

/** What the marks need. */
type MarksProps = {
  readonly vendor: Pick<IntegrationVendorView, 'wires' | 'internetRequired'>;
  readonly size?: 'small' | 'medium';
};

/**
 * The wires, then the warning: the constant facts first, the one you want to know second.
 *
 * @param props - See {@link MarksProps}.
 * @returns The marks, in a row.
 */
export function Marks(props: MarksProps) {
  const { t } = useTranslation();

  const { vendor, size = 'small' } = props;

  return (
    <span className="flex items-center gap-1.5">
      {/* The wires a person recognises: a vendor's own protocol is marked by what it goes over. */}
      {wiresOf(vendor).map((wire) => (
        <Mark key={wire} title={text(WIRES[wire].title)} glyph={WIRES[wire].glyph} size={size} />
      ))}

      {vendor.internetRequired ? (
        <Mark
          title={t('library.vendorCard.needsTheInternet', 'Needs the internet')}
          glyph={GlobeIcon}
          tone="warning"
          size={size}
        />
      ) : null}
    </span>
  );
}

/** What the logo needs. */
type LogoProps = {
  readonly vendor: Pick<IntegrationVendorView, 'name' | 'logo' | 'color' | 'logoPadding'>;

  /** The side of the square, in pixels. */
  readonly size: number;
};

/**
 * The margin every logo gets inside its square, in pixels.
 *
 * Constant, on purpose: a bundle asks for more through `logoPadding` and never for less, so
 * that no mark ever touches the edge of its tile. A monogram is text and needs none.
 */
const LOGO_BASE_PADDING = 4;

/**
 * The square that identifies a vendor at a glance: their logo, or a monogram in their colour.
 *
 * @param props - See {@link LogoProps}.
 * @returns The square.
 */
export function VendorLogo(props: LogoProps) {
  const { vendor, size } = props;
  const color = vendor.color ?? FALLBACK_COLOR;

  return (
    <span
      aria-hidden="true"
      className="flex shrink-0 items-center justify-center overflow-hidden rounded-tile border border-border-strong bg-surface-raised"
      /* eslint-disable-next-line react/forbid-dom-props -- the size and the vendor's own colour
         are values, not styles a class could carry: they come from the bundle, per vendor. */
      style={{ width: size, height: size, color }}
    >
      {vendor.logo === undefined ? (
        <span
          className="font-mono leading-none"
          /* eslint-disable-next-line react/forbid-dom-props -- scaled from the square's side. */
          style={{ fontSize: Math.round(size * 0.41) }}
        >
          {vendor.name.charAt(0).toUpperCase()}
        </span>
      ) : (
        <img
          src={vendor.logo}
          alt=""
          width={Math.max(size - 2 * (LOGO_BASE_PADDING + vendor.logoPadding), 1)}
          height={Math.max(size - 2 * (LOGO_BASE_PADDING + vendor.logoPadding), 1)}
          className="block"
        />
      )}
    </span>
  );
}

/** What the card needs. */
export type VendorCardProps = {
  readonly vendor: IntegrationVendorView;

  /** How many of its devices were found on the network and not added; none when absent. */
  readonly foundCount?: number;
};

/**
 * The word after a figure.
 *
 * @param count - The figure.
 * @param one - The singular.
 * @param many - The plural.
 * @returns Whichever fits.
 */
function noun(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

/**
 * Renders one vendor's card. The whole card is the link to the vendor's page.
 *
 * @param props - See {@link VendorCardProps}.
 * @returns The card.
 */
export function VendorCard(props: VendorCardProps) {
  const { t } = useTranslation();

  const { vendor, foundCount = 0 } = props;
  const status = vendorStatusOf(vendor);

  return (
    <li className="list-none">
      <Link to={`/integrations/${vendor.id}`} aria-label={vendor.name} className={TILE_FRAME}>
        <Tile
          logo={<VendorLogo vendor={vendor} size={44} />}
          marks={
            foundCount === 0 && !vendor.internetRequired ? undefined : (
              <>
                {foundCount > 0 ? (
                  <span
                    title={t(
                      'library.vendorCard.foundcountFoundOnThe',
                      '{{foundCount}} found on the network',
                      { foundCount: String(foundCount) },
                    )}
                    className="inline-flex h-6.5 items-center gap-1.5 rounded-chip bg-cyan/12 px-2 text-caption font-medium text-cyan tabular"
                  >
                    <AppIcon id="radio" size={13} />
                    {foundCount}
                  </span>
                ) : null}
                {vendor.internetRequired ? (
                  <Mark
                    title={t('library.vendorCard.needsTheInternet', 'Needs the internet')}
                    glyph={GlobeIcon}
                    tone="warning"
                  />
                ) : null}
              </>
            )
          }
          name={vendor.name}
          footer={
            <>
              <Pill tone={status.tone}>{status.label}</Pill>
              <span>
                {vendor.deviceCount} {noun(vendor.deviceCount, 'device', 'devices')}
              </span>
            </>
          }
        />
      </Link>
    </li>
  );
}
