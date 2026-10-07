/**
 * One device in the registry, and the way into its own page.
 *
 * The whole row is the link - the name alone is a small target for the one thing a row leads to -
 * stretched over the row the way an entity's is. What the device exposes is on its page, with
 * what each entity reads, rather than folded out under the row: a list that opened in place grew
 * a second list inside each row, and the page it now leads to has room for both.
 */
import { Link } from 'react-router';

import type { DeviceView, IconView } from '@nebulahome/contracts';
import { AppIcon, Badge } from '@nebulahome/ui';

import { relativeTime } from '@/lib/format-time';
import { type DeviceStanding } from '@/library/entity-reading';
import { devicePath } from '@/routes/library/device/device-path';
import { DeviceIcon } from '@/routes/library/device-icon';

/**
 * The column widths, shared by the header and every row so they line up.
 *
 * The name, the vendor and the area share the room that is left after the fixed columns, the
 * name taking the most: a fixed width for the two would leave the name a few letters on a
 * narrow window, and the name is what a row is recognised by.
 */
export const DEVICE_COLUMNS =
  'grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 ' +
  'md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_64px_104px_88px_30px] ' +
  'lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,0.8fr)_64px_104px_88px_30px]';

/** What one row needs. */
export type DeviceRowProps = {
  readonly device: DeviceView;

  /** The vendor's name as the catalogue has it, or its id while the catalogue is away. */
  readonly vendorName: string;

  /** The device's icon, once the catalogue has answered. */
  readonly icon: IconView | undefined;

  /** How many entities it exposes. */
  readonly entityCount: number;

  /** Whether it is reporting, and when it was last heard from. */
  readonly standing: DeviceStanding;

  /** The moment "last seen" is measured against. */
  readonly now: Date;
};

/**
 * Renders one device.
 *
 * @param props - See {@link DeviceRowProps}.
 * @returns The row.
 */
export function DeviceRow(props: DeviceRowProps) {
  const { device, vendorName, icon, entityCount, standing, now } = props;
  const isDisabled = device.state === 'disabled';
  const make = [device.manufacturer, device.model].filter(Boolean).join(' ');
  const subtitle = make === '' ? (device.externalId ?? device.id) : make;

  return (
    <li
      className={`${DEVICE_COLUMNS} relative border-b border-border px-5.5 py-3.5 transition-colors last:border-b-0 hover:bg-surface-raised has-[[data-row-link]:focus-visible]:ring-3 has-[[data-row-link]:focus-visible]:ring-primary/25 has-[[data-row-link]:focus-visible]:ring-inset`}
    >
      <span className="flex min-w-0 items-center gap-3">
        <DeviceIcon icon={icon} className="text-foreground-muted" />
        <span className="flex min-w-0 flex-col gap-0.5">
          <Link
            to={devicePath(device.id)}
            data-row-link
            title={device.id}
            className="truncate text-title font-medium text-foreground after:absolute after:inset-0 focus-visible:outline-none"
          >
            {device.name}
          </Link>
          <span className="truncate text-caption text-foreground-subtle">{subtitle}</span>
        </span>
      </span>

      <span className="hidden truncate text-ui text-foreground-muted md:block">{vendorName}</span>

      <span className="hidden truncate text-ui text-foreground-muted lg:block">
        {device.areaName ?? '—'}
      </span>

      <span className="hidden font-mono text-ui text-foreground-muted tabular md:block">
        {entityCount}
      </span>

      <span className="hidden md:block">
        <Badge tone={isDisabled ? 'neutral' : standing.isReporting ? 'success' : 'warning'}>
          {isDisabled ? 'disabled' : standing.isReporting ? 'Reporting' : 'Silent'}
        </Badge>
      </span>

      <span className="hidden text-ui text-foreground-subtle tabular md:block">
        {standing.lastSeenAt === null ? 'never' : relativeTime(standing.lastSeenAt, now)}
      </span>

      <span className="flex items-center justify-end gap-2 text-foreground-subtle">
        <span className="md:hidden">
          <Badge
            tone={isDisabled ? 'neutral' : standing.isReporting ? 'success' : 'warning'}
            size="small"
          >
            {isDisabled ? 'disabled' : standing.isReporting ? 'Reporting' : 'Silent'}
          </Badge>
        </span>
        <span aria-hidden="true">
          <AppIcon id="chevron-right" size={16} />
        </span>
      </span>
    </li>
  );
}
