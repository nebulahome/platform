/**
 * Pieces the Modbus broker's tabs share: how a device answers as a Pill, the tag of its unit, what
 * it is read with, and the devices grouped by the gateway they are behind.
 */
import { useTranslation } from 'react-i18next';

import type { ModbusDevice } from '@nebulahome/contracts';
import { AppIcon, cn, Pill } from '@nebulahome/ui';

import { relativeTime } from '@/lib/format-time';

/** One gateway: a server at an address, and the devices behind it. */
export type Gateway = {
  readonly key: string;
  readonly host: string;
  readonly port: number;
  readonly framing: 'tcp' | 'rtu';
  readonly devices: readonly ModbusDevice[];
};

/**
 * The devices, grouped by the server they are reached through, each group by unit.
 *
 * @param devices - Every device.
 * @returns The gateways, by address.
 */
export function gatewaysOf(devices: readonly ModbusDevice[]): Gateway[] {
  const byKey = new Map<string, ModbusDevice[]>();

  for (const device of devices) {
    const key = `${device.host}:${String(device.port)}`;

    byKey.set(key, [...(byKey.get(key) ?? []), device]);
  }

  return [...byKey.entries()]
    .map(([key, behind]) => {
      const [first] = behind;

      return {
        key,
        host: first?.host ?? '',
        port: first?.port ?? 502,
        framing: first?.framing ?? 'tcp',
        devices: [...behind].sort((left, right) => left.unitId - right.unitId),
      };
    })
    .sort((left, right) => left.key.localeCompare(right.key, undefined, { numeric: true }));
}

/**
 * How a device answers, as a Pill: online, no answer, or not read yet.
 *
 * @param props - The device.
 * @param props.device - It.
 * @returns The Pill.
 */
export function DeviceState(props: { readonly device: ModbusDevice }) {
  const { t } = useTranslation();
  const { device } = props;

  if (device.templateName === null) {
    return <Pill tone="warning">{t('brokers.modbus.templateMissing', 'Template missing')}</Pill>;
  }

  return device.state === 'online' ? (
    <Pill tone="success">{t('brokers.modbus.online', 'Online')}</Pill>
  ) : device.state === 'offline' ? (
    <Pill tone="danger">{t('brokers.modbus.noAnswer', 'No answer')}</Pill>
  ) : (
    <Pill>{t('brokers.modbus.waiting', 'Waiting')}</Pill>
  );
}

/**
 * The tag a device's unit is shown with, beside its name.
 *
 * @param props - The unit.
 * @param props.unitId - It.
 * @returns The tag.
 */
export function UnitTag(props: { readonly unitId: number }) {
  const { t } = useTranslation();

  return (
    <span className="rounded-pill bg-surface-raised px-1.75 py-px font-mono text-mono-caption whitespace-nowrap text-foreground-muted">
      {t('brokers.modbus.unit', 'unit {{unit}}', { unit: props.unitId })}
    </span>
  );
}

/**
 * The tag of a framing: Modbus TCP, or RTU frames carried over TCP.
 *
 * @param props - The framing.
 * @param props.framing - It.
 * @returns The tag.
 */
export function FramingTag(props: { readonly framing: 'tcp' | 'rtu' }) {
  const { t } = useTranslation();

  return (
    <span className="inline-flex h-5.5 items-center rounded-pill border border-border-strong px-2 text-caption whitespace-nowrap text-foreground-muted">
      {props.framing === 'rtu'
        ? t('brokers.modbus.rtuOverTcp', 'RTU over TCP')
        : t('brokers.modbus.tcp', 'TCP')}
    </span>
  );
}

/**
 * What a device is read with: an integration, by the first letter of its name, or one of the
 * owner's templates.
 *
 * @param props - The device's vendor, its name, and the template's.
 * @param props.vendorId - The integration whose template it is; null for one of the owner's.
 * @param props.vendorName - What the integration is called.
 * @param props.templateName - The template's name, beside the mark; none when absent.
 * @returns The chip.
 */
export function SourceChip(props: {
  readonly vendorId: string | null;
  readonly vendorName?: string | undefined;
  readonly templateName?: string | null | undefined;
}) {
  const { t } = useTranslation();
  const { vendorId, vendorName, templateName } = props;

  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 text-ui-sm text-foreground-muted">
      {vendorId === null ? (
        <span className="inline-flex size-5 shrink-0 items-center justify-center rounded-chip bg-cyan/14 text-cyan">
          <AppIcon id="braces" size={12} />
        </span>
      ) : (
        <span className="inline-flex size-5 shrink-0 items-center justify-center rounded-chip bg-surface-raised font-mono text-mono-caption text-foreground">
          {(vendorName ?? vendorId).slice(0, 1).toUpperCase()}
        </span>
      )}
      <span className="truncate">
        {templateName ??
          (vendorId === null ? t('brokers.modbus.template', 'Template') : (vendorName ?? vendorId))}
      </span>
    </span>
  );
}

/**
 * When a device was last read, or that it was not yet.
 *
 * @param props - The device.
 * @param props.device - It.
 * @param props.className - The caller's classes.
 * @returns The line.
 */
export function LastRead(props: { readonly device: ModbusDevice; readonly className?: string }) {
  const { t } = useTranslation();
  const { device } = props;

  return (
    <span className={cn('text-ui-sm text-foreground-muted', props.className)}>
      {device.lastReadAt === null
        ? t('brokers.modbus.notReadYet', 'Not read yet')
        : relativeTime(device.lastReadAt)}
    </span>
  );
}
