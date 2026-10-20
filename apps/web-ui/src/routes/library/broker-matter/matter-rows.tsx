/**
 * The Matter broker's devices, as its page lists them: one row per device of the fabric, a
 * bridge with each device behind it hanging from a line beside the icons.
 *
 * A row is named as the house names the device, with its linked tag when the house reaches it
 * another way too; under it what it is and where - "Shelly Plug S Gen3 · Utility", a bridge
 * "· bridge". On the right the integration that took it, when one did (not for the platform's
 * own mapping, nor behind a bridge), whether it answers, and the way to its page. A device
 * taken out of the house stays on the fabric, and its row offers to add it back.
 */
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import {
  MATTER_VENDOR,
  type DeviceView,
  type MatterIdentity,
  type MatterNode,
  type MatterNodeDevice,
} from '@nebulahome/contracts';
import { AppIcon, Button, cn, HeroFact, ListRow, Pill } from '@nebulahome/ui';

import { devicePath } from '@/routes/library/device/device-path';
import { DeviceIcon, type DeviceIcons } from '@/routes/library/device-icon';
import { waysOfDevice, WaysTag } from '@/routes/library/transport-marks';

/** The Matter device types of a light - on/off, dimmable, colour temperature, colour - drawn lamp-yellow. */
const LIGHT_TYPES: ReadonlySet<number> = new Set([0x01_00, 0x01_01, 0x01_0c, 0x01_0d]);

/** One device of the fabric, as a row shows it. */
export type MatterRow = {
  readonly key: string;
  readonly node: MatterNode;
  readonly device: MatterNodeDevice;

  /** The device of the house it is, its linked one when it is reached two ways. */
  readonly view: DeviceView | undefined;
  readonly name: string;

  /** What it is, then where: "Shelly Plug S Gen3 · Utility". */
  readonly parts: readonly string[];

  /** The devices behind it, for a bridge. */
  readonly children: readonly MatterRow[];
};

/**
 * The name a device is shown under before the house has it.
 *
 * @param identity - Who it says it is.
 * @returns What the owner called it in the app it came from, then what it is sold as.
 */
export function nameOf(identity: MatterIdentity): string {
  return (
    identity.nodeLabel ??
    identity.productLabel ??
    identity.productName ??
    (identity.endpoint === null
      ? `Matter ${identity.nodeId}`
      : `Matter ${identity.nodeId}:${String(identity.endpoint)}`)
  );
}

/**
 * The fabric's devices as rows: a bridge carries those behind it.
 *
 * @param nodes - The fabric's nodes.
 * @param devices - The house's devices; a linked one stands for each of its ways.
 * @param bridge - What a bridge is called, after its room.
 * @returns One row per device, a bridge's behind it.
 */
export function rowsOf(
  nodes: readonly MatterNode[],
  devices: readonly DeviceView[],
  bridge: string,
): MatterRow[] {
  const byWay = new Map<string, DeviceView>();

  for (const device of devices) {
    byWay.set(device.id, device);

    for (const way of device.linked?.ways ?? []) {
      byWay.set(way.deviceId, device);
    }
  }

  /**
   * One device's row.
   *
   * @param node - Its node.
   * @param device - It.
   * @param children - The devices behind it, for a bridge.
   * @returns The row.
   */
  const rowOf = (node: MatterNode, device: MatterNodeDevice, children: MatterRow[]): MatterRow => {
    const view = device.deviceId === null ? undefined : byWay.get(device.deviceId);
    const model = view?.model ?? device.identity.productName;

    return {
      key: `${node.nodeId}:${String(device.identity.endpoint)}`,
      node,
      device,
      view,
      name: view?.name ?? nameOf(device.identity),
      parts: [model, view?.areaName ?? null, device.identity.isBridge ? bridge : null].filter(
        (part): part is string => part !== null && part !== '',
      ),
      children,
    };
  };

  return nodes.flatMap((node) => {
    const [head, ...rest] = node.devices;

    if (head === undefined) {
      return [];
    }

    return head.identity.isBridge
      ? [
          rowOf(
            node,
            head,
            rest.map((device) => rowOf(node, device, [])),
          ),
        ]
      : node.devices.map((device) => rowOf(node, device, []));
  });
}

/**
 * Every row, a bridge's devices after it.
 *
 * @param rows - The rows.
 * @returns Them, flat.
 */
export function everyRow(rows: readonly MatterRow[]): MatterRow[] {
  return rows.flatMap((row) => [row, ...row.children]);
}

/** What one row needs. */
export type MatterDeviceRowProps = {
  readonly row: MatterRow;
  readonly icons: DeviceIcons;

  /** The integrations' names, by id. */
  readonly vendorNames: ReadonlyMap<string, string>;

  /** A line after what it is: "added 2 hours ago". */
  readonly after?: string;

  /** Whether the integration that took it is named. */
  readonly isTagged?: boolean;

  /** How it hangs from its bridge: not at all, from the line, or at the line's end. */
  readonly hang?: 'none' | 'middle' | 'last';

  /** For a bridge: whether its devices show, and how they are shown or hidden. */
  readonly isOpen?: boolean;
  readonly onToggle?: () => void;

  /** Adds a device taken out of the house back, when the person may. */
  readonly onRestore?: () => void;
  readonly isRestoring?: boolean;
};

/**
 * The line a device behind a bridge hangs from: down the icons' column, and into its own.
 *
 * @param props - Whether it is the last.
 * @param props.isLast - The line ends here.
 * @returns The line, decorative.
 */
function HangLine(props: { readonly isLast: boolean }) {
  return (
    <span aria-hidden="true" className="relative size-9 shrink-0">
      <span
        className={cn(
          'absolute -top-7.5 left-4.25 w-0 border-l border-border-strong',
          props.isLast ? 'bottom-1/2 mb-2.5' : '-bottom-7.5',
        )}
      />
      <span className="absolute top-1/2 right-0.5 left-4.25 -mt-3 h-3 rounded-bl-chip border-b border-l border-border-strong" />
    </span>
  );
}

/**
 * Renders one row.
 *
 * @param props - See {@link MatterDeviceRowProps}.
 * @returns The row.
 */
export function MatterDeviceRow(props: MatterDeviceRowProps) {
  const { t } = useTranslation();
  const {
    row,
    icons,
    vendorNames,
    after,
    isTagged = false,
    hang = 'none',
    isOpen,
    onToggle,
    onRestore,
    isRestoring = false,
  } = props;
  const { device, view, node } = row;
  const [vendorId = null] = device.kind?.split('/') ?? [];
  const tagged =
    isTagged && vendorId !== null && vendorId !== MATTER_VENDOR && !device.identity.isBridged
      ? (vendorNames.get(vendorId) ?? vendorId)
      : null;
  const isBridge = row.children.length > 0 || device.identity.isBridge;

  const title: ReactNode = (
    <span className="inline-flex items-center gap-2">
      {row.name}
      {view === undefined ? null : <WaysTag ways={waysOfDevice(view)} />}
    </span>
  );
  const subtitle = device.isRemoved
    ? t('brokers.matter.removed', 'Removed from the house')
    : [...row.parts, ...(after === undefined ? [] : [after])].join(' · ');
  const icon = (
    <span
      className={cn(
        'flex',
        device.identity.deviceTypes.some((type) => LIGHT_TYPES.has(type)) && 'text-lamp',
      )}
    >
      <DeviceIcon
        icon={view?.icon === null || view === undefined ? undefined : icons.get(view.icon)}
        {...(view === undefined ? {} : { device: view })}
        size={18}
      />
    </span>
  );
  const lead = hang === 'none' ? undefined : <HangLine isLast={hang === 'last'} />;
  const pill = (
    <Pill tone={node.isAvailable ? 'success' : 'danger'}>
      {node.isAvailable
        ? t('brokers.matter.online', 'Online')
        : t('brokers.matter.offline', 'Offline')}
    </Pill>
  );

  if (device.isRemoved) {
    return (
      <ListRow
        lead={lead}
        icon={icon}
        title={row.name}
        subtitle={subtitle}
        trailing={
          onRestore === undefined ? undefined : (
            <Button variant="ghost" size="compact" isBusy={isRestoring} onClick={onRestore}>
              {t('brokers.matter.addBack', 'Add back')}
            </Button>
          )
        }
      />
    );
  }

  if (isBridge && onToggle !== undefined) {
    return (
      <ListRow
        lead={lead}
        icon={icon}
        title={title}
        subtitle={subtitle}
        trailing={
          <>
            <span className="text-caption text-foreground-subtle">
              {t('brokers.matter.bridgeDevices', {
                count: row.children.length,
                defaultValue_one: '{{count}} device',
                defaultValue_other: '{{count}} devices',
              })}
            </span>
            {pill}
            <AppIcon
              id="chevron-down"
              size={16}
              className={cn(
                'text-foreground-muted transition-transform',
                isOpen === true && 'rotate-180',
              )}
            />
          </>
        }
        wrap={(className, parts) => (
          <button
            type="button"
            aria-expanded={isOpen === true}
            className={cn(className, 'w-full cursor-pointer text-left')}
            onClick={onToggle}
          >
            {parts}
          </button>
        )}
      />
    );
  }

  return (
    <ListRow
      lead={lead}
      icon={icon}
      title={title}
      subtitle={subtitle}
      trailing={
        <>
          {tagged === null ? null : <HeroFact>{tagged}</HeroFact>}
          {pill}
        </>
      }
      hasChevron={view !== undefined}
      {...(view === undefined
        ? {}
        : {
            /**
             * Makes the row the way to the device's page.
             *
             * @param className - The row's classes.
             * @param parts - What it shows.
             * @returns The link.
             */
            wrap: (className: string, parts: ReactNode) => (
              <Link to={devicePath(view.id)} className={className}>
                {parts}
              </Link>
            ),
          })}
    />
  );
}
