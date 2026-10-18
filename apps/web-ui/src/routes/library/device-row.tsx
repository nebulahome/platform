/**
 * One device in the registry, and the way into its own page.
 *
 * The whole row is the link - the name alone is a small target for the one thing a row leads to -
 * stretched over the row the way an entity's is. As the board draws the table: the device's glyph,
 * its name with its model under it, the integration, the room, how many entities, its status as a
 * Pill, and when it was last heard from, in mono.
 */
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import type { DeviceView, IconView } from '@nebulahome/contracts';
import { Pill } from '@nebulahome/ui';

import type { DeviceStatus } from '@/library/device-status';
import { type DeviceStanding } from '@/library/entity-reading';
import { devicePath } from '@/routes/library/device/device-path';
import { DeviceIcon } from '@/routes/library/device-icon';
import { MatterTag } from '@/routes/library/matter-tag';

/**
 * The column widths, shared by the header and every row so they line up.
 *
 * The name, the integration and the room share the room that is left after the fixed columns, the
 * name taking the most: a fixed width for them would leave the name a few letters on a narrow
 * window, and the name is what a row is recognised by.
 */
export const DEVICE_COLUMNS =
  'grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 ' +
  'md:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_72px_128px_72px] ' +
  'lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,0.9fr)_72px_128px_72px]';

/** What one row needs. */
export type DeviceRowProps = {
  readonly device: DeviceView;

  /** The vendor's name as the catalogue has it, or its id while the catalogue is away. */
  readonly vendorName: string;

  /** The device's icon, once the catalogue has answered. */
  readonly icon: IconView | undefined;

  /** How many entities it exposes. */
  readonly entityCount: number;

  /** When it was last heard from. */
  readonly standing: DeviceStanding;

  /** How it stands, in a word. */
  readonly status: DeviceStatus;

  /** The moment "seen" is measured against. */
  readonly now: Date;
};

/**
 * "Seen" in the table's short mono words: "2 s", "1 min", "3 h", "4 d".
 *
 * @param at - When it was last heard from.
 * @param now - The moment it is measured against.
 * @returns The words.
 */
function seenText(at: Date, now: Date): string {
  const seconds = Math.max(0, Math.round((now.getTime() - at.getTime()) / 1000));

  return seconds < 60
    ? `${String(seconds)} s`
    : seconds < 3600
      ? `${String(Math.floor(seconds / 60))} min`
      : seconds < 86_400
        ? `${String(Math.floor(seconds / 3600))} h`
        : `${String(Math.floor(seconds / 86_400))} d`;
}

/**
 * Renders one device.
 *
 * @param props - See {@link DeviceRowProps}.
 * @returns The row.
 */
export function DeviceRow(props: DeviceRowProps) {
  const { t } = useTranslation();

  const { device, vendorName, icon, entityCount, standing, status, now } = props;
  const make = [device.manufacturer, device.model].filter(Boolean).join(' ');
  const subtitle = make === '' ? (device.externalId ?? device.id) : make;

  return (
    <li
      className={`${DEVICE_COLUMNS} relative border-t border-border px-5 py-3 transition-colors first:border-t-0 hover:bg-surface-raised has-[[data-row-link]:focus-visible]:ring-3 has-[[data-row-link]:focus-visible]:ring-primary/25 has-[[data-row-link]:focus-visible]:ring-inset`}
    >
      <span className="flex min-w-0 items-center gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-field bg-surface-raised text-foreground-muted">
          <DeviceIcon icon={icon} />
        </span>
        <span className="flex min-w-0 flex-col gap-0.5">
          <Link
            to={devicePath(device.id)}
            data-row-link
            title={device.id}
            className="truncate text-ui font-medium text-foreground after:absolute after:inset-0 focus-visible:outline-none"
          >
            {device.name}
          </Link>
          <span className="truncate text-caption text-foreground-subtle">{subtitle}</span>
        </span>
      </span>

      <span className="hidden min-w-0 items-center gap-2 md:flex">
        <span className="truncate text-ui text-foreground-muted">{vendorName}</span>
        <MatterTag transport={device.transport} />
      </span>

      <span className="hidden truncate text-ui text-foreground-muted lg:block">
        {device.areaName ?? '—'}
      </span>

      <span className="hidden font-mono text-mono-ui text-foreground-muted tabular md:block">
        {entityCount}
      </span>

      <span className="flex md:block">
        <Pill tone={status.tone}>{status.label}</Pill>
      </span>

      <span className="hidden font-mono text-mono-caption text-foreground-subtle tabular md:block">
        {standing.lastSeenAt === null
          ? t('library.deviceRow.never', 'never')
          : seenText(standing.lastSeenAt, now)}
      </span>
    </li>
  );
}
