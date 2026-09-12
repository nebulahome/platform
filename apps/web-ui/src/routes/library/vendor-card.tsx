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
 */
import { Link } from 'react-router';

import type { IntegrationVendorView } from '@nebula-home/contracts';
import { Badge, cn } from '@nebula-home/ui';

import { GlobeIcon, HttpIcon, MqttIcon, type IconProps } from '@/components/icons';

/** The colour a vendor without one of its own is tinted with. */
const FALLBACK_COLOR = '#6d7bff';

/** A glyph, as the icon set draws one. */
type Glyph = (props: IconProps) => React.ReactNode;

/** What each wire is drawn as, and what the tooltip says. */
const WIRES: Readonly<Record<string, { readonly glyph: Glyph; readonly title: string }>> = {
  http: { glyph: HttpIcon, title: 'Speaks HTTP to each device' },
  mqtt: { glyph: MqttIcon, title: 'Listens on the MQTT broker' },
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
    <span
      title={title}
      aria-label={title}
      role="img"
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full border',
        size === 'small' ? 'size-[26px]' : 'size-7',
        tone === 'warning'
          ? 'border-warning/30 bg-warning/13 text-warning'
          : 'border-border-soft face-raised text-foreground-muted',
      )}
    >
      <Icon width={size === 'small' ? 13 : 14} height={size === 'small' ? 13 : 14} />
    </span>
  );
}

/** What the marks need. */
type MarksProps = {
  readonly vendor: Pick<IntegrationVendorView, 'transports' | 'internetRequired'>;
  readonly size?: 'small' | 'medium';
};

/**
 * The wires, then the warning: the constant facts first, the one you want to know second.
 *
 * @param props - See {@link MarksProps}.
 * @returns The marks, in a row.
 */
export function Marks(props: MarksProps) {
  const { vendor, size = 'small' } = props;

  return (
    <span className="flex items-center gap-1.5">
      {vendor.transports.map((transport) => {
        const wire = WIRES[transport];

        return wire === undefined ? null : (
          <Mark key={transport} title={wire.title} glyph={wire.glyph} size={size} />
        );
      })}

      {vendor.internetRequired ? (
        <Mark title="Needs the internet" glyph={GlobeIcon} tone="warning" size={size} />
      ) : null}
    </span>
  );
}

/** What the logo needs. */
type LogoProps = {
  readonly vendor: Pick<IntegrationVendorView, 'name' | 'logo' | 'color'>;

  /** The side of the square, in pixels. */
  readonly size: number;
};

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
      className="flex shrink-0 items-center justify-center overflow-hidden rounded-tile"
      /* eslint-disable-next-line react/forbid-dom-props -- the size and the vendor's own colour
         are values, not styles a class could carry: they come from the bundle, per vendor. */
      style={{
        width: size,
        height: size,
        backgroundColor: `color-mix(in srgb, ${color} 14%, transparent)`,
        boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${color} 14%, transparent), inset 0 1px 0 rgb(255 255 255 / 0.04)`,
        color,
      }}
    >
      {vendor.logo === undefined ? (
        <span
          className="leading-none font-semibold tracking-tight"
          /* eslint-disable-next-line react/forbid-dom-props -- scaled from the square's side. */
          style={{ fontSize: Math.round(size * 0.43) }}
        >
          {vendor.name.charAt(0).toUpperCase()}
        </span>
      ) : (
        <img src={vendor.logo} alt="" width={size} height={size} className="block" />
      )}
    </span>
  );
}

/** What the card needs. */
export type VendorCardProps = {
  readonly vendor: IntegrationVendorView;
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
  const { vendor } = props;

  return (
    <li className="list-none">
      <Link
        to={`/integrations/${vendor.id}`}
        aria-label={vendor.name}
        className={cn(
          'flex h-41 flex-col rounded-panel border border-border face-card p-[18px]',
          'transition-[border-color,box-shadow] hover:border-border-strong hover:shadow-card',
          'focus-visible:ring-3 focus-visible:ring-primary/25 focus-visible:outline-none',
        )}
      >
        <span className="flex items-start gap-1.5">
          <VendorLogo vendor={vendor} size={44} />
          <span className="grow" />
          <Marks vendor={vendor} />
        </span>

        <span className="mt-4 flex min-w-0 flex-col gap-1">
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate text-[15px] leading-tight font-medium text-foreground">
              {vendor.name}
            </span>
            {vendor.needsSetup ? (
              <Badge tone="warning" size="small">
                Needs setup
              </Badge>
            ) : null}
          </span>
          <span className="text-caption leading-tight text-foreground-subtle tabular">
            v{vendor.version}
          </span>
        </span>

        <span className="grow" />

        {/* The devices are the instances: each one was added by hand, by its address, and is
            what the vendor page lists under Devices. */}
        <span className="mt-3 flex items-baseline gap-1 text-ui leading-tight text-foreground-muted tabular">
          <span className="font-medium text-foreground">{vendor.instanceCount}</span>
          <span>{noun(vendor.instanceCount, 'device', 'devices')}</span>
          <span className="mx-1 text-foreground-subtle">·</span>
          <span className="font-medium text-foreground">{vendor.entityCount}</span>
          <span>{noun(vendor.entityCount, 'entity', 'entities')}</span>
        </span>
      </Link>
    </li>
  );
}
