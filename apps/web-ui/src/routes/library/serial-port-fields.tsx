/**
 * The serial port a device of a `kind: serial` driver is added on, and its baud rate: the card
 * the device dialog shows before the driver's own fields.
 *
 * The ports offered are the free ones the Serial broker sees - the ones this integration
 * recognises first, under their own heading - plus the one the device already holds. The baud
 * rate starts at the driver's default, named so. The rest of the line (data bits, parity, stop
 * bits, flow control) stays the driver's.
 */
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import {
  SERIAL_BAUD_RATES,
  type SerialDeviceConfig,
  type SerialLine,
  type SerialPort,
} from '@nebulahome/contracts';
import { SelectField } from '@nebulahome/ui';

import { fetchSerialPorts, SERIAL_QUERY_KEYS } from '@/library/serial-api';

/** What the card needs. */
export type SerialPortFieldsProps = {
  /** The integration whose driver it is: its rule's ports come first. */
  readonly vendorId: string;

  /** The device being edited, whose port is offered too. */
  readonly deviceId?: string | undefined;

  /** The driver's line, which the baud rate starts from. */
  readonly driverLine: SerialLine;

  /** The port and line chosen; an empty port id while none is. */
  readonly value: SerialDeviceConfig;
  readonly onChange: (value: SerialDeviceConfig) => void;

  /** What is wrong with the port, when something is. */
  readonly error?: string | undefined;
};

/**
 * Whether an integration's rule recognises a port.
 *
 * @param port - The port.
 * @param vendorId - The integration.
 * @returns True when one of its rules matched.
 */
export function isRecognisedBy(port: SerialPort, vendorId: string): boolean {
  return port.claims.some((claim) => claim.kind === 'integration' && claim.vendorId === vendorId);
}

/**
 * The ports a device can be put on: free and plugged in, or already its own; recognised first.
 *
 * @param ports - Every port.
 * @param vendorId - The integration whose rules sort them.
 * @param deviceId - The device that may already hold one.
 * @returns The ports.
 */
export function freePortsFor(
  ports: readonly SerialPort[],
  vendorId: string,
  deviceId?: string,
): SerialPort[] {
  return ports
    .filter(
      (port) =>
        !port.isIgnored &&
        ((port.holder === null && port.isConnected) ||
          (deviceId !== undefined && port.holder?.deviceId === deviceId)),
    )
    .sort(
      (one, other) =>
        Number(isRecognisedBy(other, vendorId)) - Number(isRecognisedBy(one, vendorId)),
    );
}

/**
 * Renders the card.
 *
 * @param props - See {@link SerialPortFieldsProps}.
 * @returns The card.
 */
export function SerialPortFields(props: SerialPortFieldsProps) {
  const { t } = useTranslation();
  const { vendorId, deviceId, driverLine, value, onChange } = props;
  const ports = useQuery({
    queryKey: SERIAL_QUERY_KEYS.ports,

    /**
     * Reads the ports the server sees.
     *
     * @param context - The query's abort signal.
     * @param context.signal - Cancels the request when the dialog goes away.
     * @returns The ports.
     */
    queryFn: async ({ signal }) => fetchSerialPorts(signal),
  });
  const offered = freePortsFor(ports.data ?? [], vendorId, deviceId);
  const recognised = t('library.serialPort.recognised', 'Recognised');
  const others = t('library.serialPort.free', 'Free ports');

  return (
    <fieldset className="flex flex-col gap-4 rounded-card border border-border px-4 py-4">
      <legend className="px-1 font-mono text-label text-foreground-subtle uppercase">
        {t('library.serialPort.title', 'Serial port')}
      </legend>
      <SelectField
        label={t('library.serialPort.port', 'Port')}
        value={value.portId}
        onChange={(portId) => {
          onChange({ ...value, portId });
        }}
        error={props.error}
        hint={
          offered.length === 0 && !ports.isPending
            ? t(
                'library.serialPort.none',
                'No free port: plug the cable in, or free one on the Serial page.',
              )
            : t(
                'library.serialPort.hint',
                'Free ports only, the ones this driver recognises first. Ports in use are on the Serial page.',
              )
        }
        options={[
          { value: '', label: t('library.serialPort.pick', 'Pick a port') },
          ...offered.map((port) => ({
            value: port.id,
            label: port.name,
            group: isRecognisedBy(port, vendorId) ? recognised : others,
          })),
        ]}
      />
      <SelectField
        label={t('library.serialPort.baud', 'Baud rate')}
        value={String(value.line.baudRate)}
        onChange={(baud) => {
          onChange({ ...value, line: { ...value.line, baudRate: Number(baud) } });
        }}
        options={[...new Set([...SERIAL_BAUD_RATES, driverLine.baudRate])]
          .sort((one, other) => one - other)
          .map((rate) => ({
            value: String(rate),
            label:
              rate === driverLine.baudRate
                ? t('library.serialPort.driverDefault', '{{rate}} · the driver’s default', {
                    rate,
                  })
                : String(rate),
          }))}
      />
    </fieldset>
  );
}
