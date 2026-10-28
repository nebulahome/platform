/**
 * The Serial broker's dialogs: Use with…, Add network port, Settings, and the Console.
 *
 * **Use with…** takes a free port to whoever will hold it: integrations whose rule matches it
 * first, then the others with serial drivers, then the brokers that take a port (Thread's radio,
 * which goes on to Thread's Set up). Containers are not offered: a port given to a managed
 * container is released from the container's own page. Step two is the line - the baud rate with
 * its presets, the rest under Advanced, filled from the driver - and step three the driver's own
 * form, which is the device dialog, with the port and line already in it.
 *
 * **The Console** holds a free port while it is open, for trying a protocol before writing its
 * integration: what crossed the port, timestamped, as text or hex; a line to send with its ending.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  SERIAL_BAUD_RATES,
  SERIAL_FLOW_CONTROLS,
  SERIAL_PARITIES,
  serialLineText,
  type IntegrationVendorView,
  type SerialConsoleChunk,
  type SerialLine,
  type SerialNetworkProtocol,
  type SerialPort,
  type SerialStatus,
} from '@nebulahome/contracts';
import {
  AppIcon,
  Button,
  cn,
  Modal,
  Note,
  Segmented,
  SelectField,
  Switch,
  TextField,
  WizardSteps,
} from '@nebulahome/ui';

import { ThreadLogo } from '@/components/brand-logos';
import { translate } from '@/i18n/messages';
import { toMessage } from '@/lib/error-message';
import {
  closeSerialConsole,
  ignoreSerialPort,
  openSerialConsole,
  readSerialConsole,
  saveSerialNetworkPort,
  saveSerialSettings,
  testSerialNetworkPort,
  writeSerialConsole,
} from '@/library/serial-api';
import { ChoiceCard } from '@/routes/library/broker-parts';
import { BrokerMark } from '@/routes/library/brokers-page';
import { isRecognisedBy } from '@/routes/library/serial-port-fields';

/** The default line: 8N1 at 9600. */
const DEFAULT_LINE: SerialLine = {
  baudRate: 9600,
  dataBits: 8,
  parity: 'none',
  stopBits: 1,
  flowControl: 'none',
};

/** The presets shown under the baud rate. */
const BAUD_PRESETS = [9600, 19_200, 38_400, 57_600, 115_200, 460_800] as const;

/** Who a port is used with. */
export type UseWithChoice =
  | {
      readonly kind: 'integration';
      readonly vendor: IntegrationVendorView;
      readonly driverKind: string;
    }
  | { readonly kind: 'thread' };

/** What Use with… needs. */
export type UseWithDialogProps = {
  readonly port: SerialPort;
  readonly vendors: readonly IntegrationVendorView[];
  readonly onClose: () => void;

  /** Goes on to the driver's form with the port and line chosen. */
  readonly onDevice: (vendor: IntegrationVendorView, driverKind: string, line: SerialLine) => void;

  /** Goes on to Thread's Set up with the port. */
  readonly onThread: () => void;
};

/**
 * A port's line when it is only plugged in.
 *
 * @param vendor - The integration.
 * @param driverKind - Its driver.
 * @returns The driver's line, or 8N1 at 9600.
 */
function driverLineOf(vendor: IntegrationVendorView, driverKind: string): SerialLine {
  return vendor.drivers.find((driver) => driver.id === driverKind)?.serial ?? DEFAULT_LINE;
}

/**
 * Renders Use with….
 *
 * @param props - See {@link UseWithDialogProps}.
 * @returns The dialog.
 */
export function UseWithDialog(props: UseWithDialogProps) {
  const { t } = useTranslation();
  const { port, vendors, onClose } = props;
  const serialVendors = vendors.filter((vendor) =>
    vendor.drivers.some((driver) => driver.serial !== undefined),
  );
  const recognised = serialVendors.filter((vendor) => isRecognisedBy(port, vendor.id));
  const others = serialVendors.filter((vendor) => !isRecognisedBy(port, vendor.id));
  const isRadio = port.claims.some((claim) => claim.kind === 'broker');
  const first = recognised[0] ?? others[0];
  const [step, setStep] = useState(0);
  const [choice, setChoice] = useState<UseWithChoice | null>(() =>
    isRadio
      ? { kind: 'thread' }
      : first === undefined
        ? null
        : { kind: 'integration', vendor: first, driverKind: serialDriverOf(first) },
  );
  const [line, setLine] = useState<SerialLine>(() =>
    choice?.kind === 'integration' ? driverLineOf(choice.vendor, choice.driverKind) : DEFAULT_LINE,
  );

  /**
   * Picks who uses the port, and starts its line from its driver's.
   *
   * @param next - The choice.
   */
  const pick = (next: UseWithChoice): void => {
    setChoice(next);

    if (next.kind === 'integration') {
      setLine(driverLineOf(next.vendor, next.driverKind));
    }
  };

  /**
   * One integration as a choice.
   *
   * @param vendor - The integration.
   * @param isMatch - Whether its rule matched the port.
   * @returns The card.
   */
  const vendorCard = (vendor: IntegrationVendorView, isMatch: boolean) => (
    <ChoiceCard
      key={vendor.id}
      isChosen={choice?.kind === 'integration' && choice.vendor.id === vendor.id}
      onSelect={() => {
        pick({ kind: 'integration', vendor, driverKind: serialDriverOf(vendor) });
      }}
      className="items-start py-3.5"
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-field bg-surface-raised font-mono text-mono-ui text-primary">
        {vendor.name.slice(0, 1).toUpperCase()}
      </span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-ui font-medium text-foreground">{vendor.name}</span>
        <span className="text-ui-sm leading-normal text-foreground-muted">
          {isMatch
            ? t('brokers.serial.useWith.matches', 'Its rule matches this cable. {{about}}', {
                about: vendor.description,
              })
            : vendor.description}
        </span>
      </span>
    </ChoiceCard>
  );
  const group = 'font-mono text-label text-foreground-subtle uppercase';

  return (
    <Modal
      isOpen
      onClose={onClose}
      size="large"
      layout="card"
      lead={<BrokerMark broker="serial" size={44} isLit />}
      title={t('brokers.serial.useWith.title', 'Use this port')}
      description={
        port.usb?.serialNumber == null
          ? port.name
          : t('brokers.serial.useWith.line', '{{name}} · serial {{serial}}', {
              name: port.name,
              serial: port.usb.serialNumber,
            })
      }
      footer={
        <>
          <span />
          <span className="flex items-center gap-2">
            <Button
              variant="bare"
              onClick={() => {
                if (step === 0) {
                  onClose();
                } else {
                  setStep(0);
                }
              }}
            >
              {step === 0 ? t('common.cancel', 'Cancel') : t('common.back', 'Back')}
            </Button>
            <Button
              disabled={choice === null}
              onClick={() => {
                if (choice?.kind === 'thread') {
                  props.onThread();
                } else if (choice !== null && step === 0) {
                  setStep(1);
                } else if (choice !== null) {
                  props.onDevice(choice.vendor, choice.driverKind, line);
                }
              }}
            >
              {t('common.next', 'Next')}
            </Button>
          </span>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <WizardSteps
          layout="stacked"
          current={step}
          steps={[
            t('brokers.serial.useWith.who', 'Who'),
            t('brokers.serial.useWith.portSettings', 'Port settings'),
            t('brokers.serial.useWith.device', 'Device'),
          ]}
        />

        {step === 0 ? (
          <div role="radiogroup" className="flex flex-col gap-2.5">
            {recognised.length === 0 ? null : (
              <>
                <span className={group}>
                  {t('brokers.serial.useWith.recognised', 'Recognised')}
                </span>
                {recognised.map((vendor) => vendorCard(vendor, true))}
              </>
            )}
            {others.length === 0 ? null : (
              <>
                <span className={cn(group, 'mt-1.5')}>
                  {t('brokers.serial.useWith.others', 'Other integrations with serial drivers')}
                </span>
                {others.map((vendor) => vendorCard(vendor, false))}
              </>
            )}
            <span className={cn(group, 'mt-1.5')}>
              {t('brokers.serial.useWith.brokers', 'Brokers')}
            </span>
            <ChoiceCard
              isChosen={choice?.kind === 'thread'}
              onSelect={() => {
                pick({ kind: 'thread' });
              }}
              className="items-start py-3.5"
            >
              <span className="flex size-9 shrink-0 items-center justify-center rounded-field bg-surface-raised">
                <ThreadLogo width={18} height={18} />
              </span>
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="text-ui font-medium text-foreground">
                  {t('brokers.serial.useWith.threadRadio', 'Thread radio')}
                </span>
                <span className="text-ui-sm text-foreground-muted">
                  {t(
                    'brokers.serial.useWith.threadLine',
                    'For a SkyConnect or an nRF52840 dongle. Goes on to Thread’s Set up.',
                  )}
                </span>
              </span>
            </ChoiceCard>
            <p className="text-caption leading-normal text-foreground-subtle">
              {t(
                'brokers.serial.useWith.containers',
                'Containers are not offered here: a port given to a managed container is released from the container’s own page.',
              )}
            </p>
          </div>
        ) : choice?.kind === 'integration' ? (
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-3 rounded-inner border border-border px-4 py-3">
              <span className="flex size-7 shrink-0 items-center justify-center rounded-chip bg-surface-raised font-mono text-mono-caption text-primary">
                {choice.vendor.name.slice(0, 1).toUpperCase()}
              </span>
              <span className="grow text-ui text-foreground-muted">
                {t('brokers.serial.useWith.onPort', '{{vendor}} on {{port}}', {
                  vendor: choice.vendor.name,
                  port: port.name,
                })}
              </span>
              <Button
                variant="bare"
                size="compact"
                onClick={() => {
                  setStep(0);
                }}
              >
                {t('brokers.serial.useWith.change', 'Change')}
              </Button>
            </div>
            <LineFields
              line={line}
              driverLine={driverLineOf(choice.vendor, choice.driverKind)}
              onChange={setLine}
            />
          </div>
        ) : null}
      </div>
    </Modal>
  );
}

/**
 * An integration's first serial driver.
 *
 * @param vendor - The integration.
 * @returns The driver's kind.
 */
function serialDriverOf(vendor: IntegrationVendorView): string {
  return vendor.drivers.find((driver) => driver.serial !== undefined)?.id ?? '';
}

/**
 * A port's line: the baud rate and its presets, the rest under Advanced.
 *
 * @param props - The line, the driver's, and how it changes.
 * @param props.line - The line.
 * @param props.driverLine - The driver's, which it starts from.
 * @param props.onChange - Called with the line changed.
 * @returns The fields.
 */
export function LineFields(props: {
  readonly line: SerialLine;
  readonly driverLine: SerialLine;
  readonly onChange: (line: SerialLine) => void;
}) {
  const { t } = useTranslation();
  const { line, driverLine, onChange } = props;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <SelectField
          label={t('brokers.serial.line.baud', 'Baud rate')}
          value={String(line.baudRate)}
          onChange={(value) => {
            onChange({ ...line, baudRate: Number(value) });
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
        <span className="flex flex-wrap gap-1.5">
          {BAUD_PRESETS.map((rate) => (
            <button
              key={rate}
              type="button"
              onClick={() => {
                onChange({ ...line, baudRate: rate });
              }}
              className={cn(
                'rounded-pill px-2 py-0.5 font-mono text-mono-caption',
                line.baudRate === rate
                  ? 'bg-surface-high text-foreground'
                  : 'bg-surface-raised text-foreground-muted hover:text-foreground',
              )}
            >
              {rate}
            </button>
          ))}
        </span>
      </div>
      <details className="rounded-inner border border-border px-4 py-3" open>
        <summary className="cursor-pointer text-ui-sm text-foreground">
          {t('brokers.serial.line.advanced', 'Advanced · filled from the driver')}
        </summary>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <SelectField
            label={t('brokers.serial.line.dataBits', 'Data bits')}
            value={String(line.dataBits)}
            onChange={(value) => {
              onChange({ ...line, dataBits: Number(value) as SerialLine['dataBits'] });
            }}
            options={['5', '6', '7', '8'].map((bits) => ({ value: bits, label: bits }))}
          />
          <SelectField
            label={t('brokers.serial.line.parity', 'Parity')}
            value={line.parity}
            onChange={(value) => {
              onChange({
                ...line,
                parity: SERIAL_PARITIES.find((each) => each === value) ?? 'none',
              });
            }}
            options={SERIAL_PARITIES.map((parity) => ({
              value: parity,
              label: parityName(parity),
            }))}
          />
          <SelectField
            label={t('brokers.serial.line.stopBits', 'Stop bits')}
            value={String(line.stopBits)}
            onChange={(value) => {
              onChange({ ...line, stopBits: Number(value) as SerialLine['stopBits'] });
            }}
            options={['1', '1.5', '2'].map((bits) => ({ value: bits, label: bits }))}
          />
          <SelectField
            label={t('brokers.serial.line.flow', 'Flow control')}
            value={line.flowControl}
            onChange={(value) => {
              onChange({
                ...line,
                flowControl: SERIAL_FLOW_CONTROLS.find((each) => each === value) ?? 'none',
              });
            }}
            options={SERIAL_FLOW_CONTROLS.map((flow) => ({
              value: flow,
              label:
                flow === 'none'
                  ? t('brokers.serial.line.none', 'None')
                  : flow === 'rtscts'
                    ? t('brokers.serial.line.rtscts', 'RTS/CTS')
                    : t('brokers.serial.line.xonxoff', 'XON/XOFF'),
            }))}
          />
        </div>
      </details>
    </div>
  );
}

/**
 * A parity in words.
 *
 * @param parity - The parity.
 * @returns Its name.
 */
function parityName(parity: (typeof SERIAL_PARITIES)[number]): string {
  switch (parity) {
    case 'none':
      return translate('brokers.serial.parity.none', 'None');
    case 'even':
      return translate('brokers.serial.parity.even', 'Even');
    case 'odd':
      return translate('brokers.serial.parity.odd', 'Odd');
    case 'mark':
      return translate('brokers.serial.parity.mark', 'Mark');
    case 'space':
      return translate('brokers.serial.parity.space', 'Space');
  }
}

/** What Add network port needs. */
export type NetworkPortDialogProps = {
  readonly onClose: () => void;
};

/**
 * Renders Add network port: a name, an address, raw TCP or RFC 2217, and a Test.
 *
 * @param props - See {@link NetworkPortDialogProps}.
 * @returns The dialog.
 */
export function NetworkPortDialog(props: NetworkPortDialogProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [host, setHost] = useState('');
  const [portText, setPortText] = useState('');
  const [protocol, setProtocol] = useState<SerialNetworkProtocol>('raw');
  const portNumber = Number(portText);
  const isValid =
    name.trim() !== '' &&
    host.trim() !== '' &&
    Number.isInteger(portNumber) &&
    portNumber >= 1 &&
    portNumber <= 65_535;
  const address = { host: host.trim(), port: portNumber, protocol };

  const test = useMutation({
    /**
     * Opens the socket once.
     *
     * @returns Whether it connected.
     */
    mutationFn: async () => testSerialNetworkPort(address),
  });
  const save = useMutation({
    /**
     * Saves the port.
     *
     * @returns It.
     */
    mutationFn: async () => saveSerialNetworkPort({ name: name.trim(), ...address }),

    /** Reads the ports again and closes. */
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['brokers', 'serial'] });
      props.onClose();
    },
  });

  return (
    <Modal
      isOpen
      onClose={props.onClose}
      size="form"
      layout="card"
      lead={<BrokerMark broker="serial" size={44} isLit />}
      title={t('brokers.serial.network.title', 'Add a network port')}
      description={t(
        'brokers.serial.network.line',
        'A serial port on the network: ser2net, an ESP serial bridge',
      )}
      closesOnBackdrop={name === '' && host === ''}
      footer={
        <>
          <Button
            variant="ghost"
            disabled={!isValid}
            isBusy={test.isPending}
            onClick={() => {
              test.mutate();
            }}
          >
            {t('brokers.serial.network.test', 'Test')}
          </Button>
          <span className="flex items-center gap-2">
            <Button variant="bare" onClick={props.onClose}>
              {t('common.cancel', 'Cancel')}
            </Button>
            <Button
              disabled={!isValid}
              isBusy={save.isPending}
              onClick={() => {
                save.mutate();
              }}
            >
              {t('brokers.serial.network.add', 'Add port')}
            </Button>
          </span>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <TextField
          label={t('brokers.serial.network.name', 'Name')}
          value={name}
          placeholder={t('brokers.serial.network.namePlaceholder', 'Meter cabinet ser2net')}
          onChange={(event) => {
            setName(event.target.value);
          }}
        />
        <div className="grid grid-cols-[1fr_8rem] gap-3">
          <TextField
            label={t('brokers.serial.network.host', 'Address')}
            value={host}
            placeholder="192.168.1.50"
            className="font-mono"
            onChange={(event) => {
              setHost(event.target.value);
            }}
          />
          <TextField
            label={t('brokers.serial.network.port', 'Port')}
            value={portText}
            inputMode="numeric"
            placeholder="6638"
            className="font-mono"
            onChange={(event) => {
              setPortText(event.target.value);
            }}
          />
        </div>
        <div className="flex flex-col gap-2">
          <span className="text-ui-sm text-foreground-muted">
            {t('brokers.serial.network.protocol', 'Protocol')}
          </span>
          <Segmented
            label={t('brokers.serial.network.protocol', 'Protocol')}
            value={protocol}
            onChange={setProtocol}
            isFilled
            options={[
              { value: 'raw', label: t('brokers.serial.rawTcp', 'Raw TCP') },
              { value: 'rfc2217', label: t('brokers.serial.rfc2217', 'RFC 2217') },
            ]}
          />
          <span className="text-caption text-foreground-subtle">
            {protocol === 'raw'
              ? t('brokers.serial.network.rawHint', 'The line is set on the bridge itself.')
              : t('brokers.serial.network.rfcHint', 'The house sets the line through the bridge.')}
          </span>
        </div>
        {test.data === undefined ? null : test.data.isConnected ? (
          <span className="flex items-center gap-2 text-ui-sm text-success">
            <AppIcon id="circle-check" size={16} />
            {test.data.ms === null
              ? t('brokers.serial.network.connected', 'Connected')
              : t('brokers.serial.network.connectedIn', 'Connected in {{ms}} ms', {
                  ms: test.data.ms,
                })}
          </span>
        ) : (
          <Note tone="danger">
            {test.data.error ?? t('brokers.serial.network.failed', 'It did not connect')}
          </Note>
        )}
        {[test.error, save.error].map((error) =>
          error === null ? null : (
            <Note key={toMessage(error)} tone="danger">
              {toMessage(error)}
            </Note>
          ),
        )}
      </div>
    </Modal>
  );
}

/** What Settings needs. */
export type SerialSettingsDialogProps = {
  readonly status: SerialStatus;
  readonly ports: readonly SerialPort[];
  readonly onClose: () => void;
};

/**
 * Renders Settings: built-in ports shown or not, and the ports ignored with Restore.
 *
 * @param props - See {@link SerialSettingsDialogProps}.
 * @returns The dialog.
 */
export function SerialSettingsDialog(props: SerialSettingsDialogProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [showBuiltin, setShowBuiltin] = useState(props.status.settings.showBuiltin);
  const ignored = props.ports.filter((port) => port.isIgnored);

  /** Reads the broker again. */
  const refresh = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['brokers', 'serial'] });
  };

  const save = useMutation({
    /**
     * Saves the settings.
     *
     * @returns Where the broker stands.
     */
    mutationFn: async () => saveSerialSettings({ showBuiltin }),

    /** Reads it again and closes. */
    onSuccess: () => {
      refresh();
      props.onClose();
    },
  });
  const restore = useMutation({
    /**
     * Stops ignoring a port.
     *
     * @param portId - The port.
     * @returns It.
     */
    mutationFn: async (portId: string) => ignoreSerialPort(portId, false),
    onSettled: refresh,
  });

  return (
    <Modal
      isOpen
      onClose={props.onClose}
      size="form"
      layout="card"
      lead={<BrokerMark broker="serial" size={44} isLit />}
      title={t('brokers.serial.settings.title', 'Serial settings')}
      footer={
        <>
          <span />
          <span className="flex items-center gap-2">
            <Button variant="bare" onClick={props.onClose}>
              {t('common.cancel', 'Cancel')}
            </Button>
            <Button
              isBusy={save.isPending}
              onClick={() => {
                save.mutate();
              }}
            >
              {t('brokers.serial.settings.save', 'Save')}
            </Button>
          </span>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <div className="flex items-start justify-between gap-4">
          <span className="flex flex-col gap-0.5">
            <span className="text-ui font-medium text-foreground">
              {t('brokers.serial.settings.builtin', 'Show built-in ports')}
            </span>
            <span className="text-ui-sm text-foreground-muted">
              {t(
                'brokers.serial.settings.builtinLine',
                'The server’s own ttyS ports. Off by default: most are not wired to anything.',
              )}
            </span>
          </span>
          <Switch
            label={t('brokers.serial.settings.builtin', 'Show built-in ports')}
            isOn={showBuiltin}
            onChange={setShowBuiltin}
          />
        </div>
        <div className="flex flex-col gap-2">
          <span className="font-mono text-label text-foreground-subtle uppercase">
            {t('brokers.serial.settings.ignored', 'Ignored ports')}
          </span>
          {ignored.length === 0 ? (
            <span className="text-ui-sm text-foreground-muted">
              {t('brokers.serial.settings.noIgnored', 'None: every port is offered.')}
            </span>
          ) : (
            <ul className="flex flex-col rounded-inner border border-border">
              {ignored.map((port) => (
                <li
                  key={port.id}
                  className="flex items-center gap-3 border-t border-border px-4 py-2.5 first:border-t-0"
                >
                  <span className="flex min-w-0 grow flex-col">
                    <span className="truncate text-ui text-foreground">{port.name}</span>
                    <span className="truncate font-mono text-mono-caption text-foreground-muted">
                      {port.path}
                    </span>
                  </span>
                  <Button
                    variant="ghost"
                    size="compact"
                    isBusy={restore.isPending && restore.variables === port.id}
                    onClick={() => {
                      restore.mutate(port.id);
                    }}
                  >
                    {t('brokers.serial.settings.restore', 'Restore')}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
        {save.error === null ? null : <Note tone="danger">{toMessage(save.error)}</Note>}
      </div>
    </Modal>
  );
}

/** How often the console reads what crossed the port. */
const CONSOLE_POLL_MS = 500;

/** The console's chunks kept on screen. */
const CONSOLE_KEPT = 2000;

/** What the Console needs. */
export type ConsoleDialogProps = {
  readonly port: SerialPort;
  readonly onClose: () => void;

  /** Chunks to start from, for the gallery. */
  readonly sample?: readonly SerialConsoleChunk[];
};

/**
 * Bytes as text: printable characters kept, the rest as dots.
 *
 * @param hex - The bytes, as hex.
 * @returns The text.
 */
function hexToText(hex: string): string {
  return (hex.match(/../gu) ?? [])
    .map((byte) => {
      const code = Number.parseInt(byte, 16);

      return code === 9 || (code >= 32 && code < 127) ? String.fromCodePoint(code) : '·';
    })
    .join('');
}

/**
 * Text as bytes, in hex.
 *
 * @param text - The text.
 * @returns The bytes.
 */
function textToHex(text: string): string {
  return [...new TextEncoder().encode(text)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * A chunk's time, to the millisecond.
 *
 * @param at - When it crossed.
 * @returns `10:41:02.118`.
 */
function clock(at: Date): string {
  return `${at.toTimeString().slice(0, 8)}.${String(at.getMilliseconds()).padStart(3, '0')}`;
}

/**
 * Renders the Console.
 *
 * @param props - See {@link ConsoleDialogProps}.
 * @returns The dialog.
 */
export function ConsoleDialog(props: ConsoleDialogProps) {
  const { t } = useTranslation();
  const { port, onClose } = props;
  const [line, setLine] = useState<SerialLine>(port.line ?? DEFAULT_LINE);
  const [view, setView] = useState<'text' | 'hex'>('text');
  const [chunks, setChunks] = useState<readonly SerialConsoleChunk[]>(props.sample ?? []);
  const [isPaused, setPaused] = useState(false);
  const [input, setInput] = useState('');
  const [ending, setEnding] = useState<'none' | 'lf' | 'crlf'>('lf');
  const cursor = useRef<number | undefined>(undefined);

  const open = useQuery({
    queryKey: ['brokers', 'serial', 'console', port.id, line.baudRate],
    enabled: props.sample === undefined,
    staleTime: Infinity,
    retry: false,

    /**
     * Opens the console on the port, at its line.
     *
     * @returns The console.
     */
    queryFn: async () => openSerialConsole(port.id, line),
  });
  const consoleId = open.data?.consoleId ?? null;

  // shortcut: polled, move to the websocket topic if latency matters.
  useQuery({
    queryKey: ['brokers', 'serial', 'console', 'read', consoleId ?? ''],
    enabled: consoleId !== null && !isPaused,
    refetchInterval: CONSOLE_POLL_MS,

    /**
     * Reads what crossed since the last read, and adds it to the log.
     *
     * @param context - The query's abort signal.
     * @param context.signal - Cancels the request.
     * @returns The reply.
     */
    queryFn: async ({ signal }) => {
      const reply = await readSerialConsole(consoleId ?? '', cursor.current, signal);

      cursor.current = reply.cursor;
      setChunks((was) => [...was, ...reply.chunks].slice(-CONSOLE_KEPT));

      return reply;
    },
  });

  useEffect(
    () => () => {
      if (consoleId !== null) {
        void closeSerialConsole(consoleId).catch(() => undefined);
      }
    },
    [consoleId],
  );

  const send = useMutation({
    /**
     * Writes the line typed.
     *
     * @returns How many bytes went.
     */
    mutationFn: async () =>
      writeSerialConsole(
        consoleId ?? '',
        view === 'hex' ? input.replaceAll(/[^0-9a-f]/giu, '') : textToHex(input),
        ending,
      ),

    /** Clears the line. */
    onSuccess: () => {
      setInput('');
    },
  });

  return (
    <Modal
      isOpen
      onClose={onClose}
      size="xlarge"
      layout="card"
      lead={
        <span className="flex size-11 items-center justify-center rounded-inner border border-border-strong bg-surface-raised text-foreground">
          <AppIcon id="terminal" size={20} />
        </span>
      }
      title={t('brokers.serial.console.title', 'Console')}
      description={t(
        'brokers.serial.console.line',
        '{{port}} · a free port · try a protocol before writing its integration',
        { port: port.name },
      )}
      footer={
        <div className="flex w-full items-center gap-2">
          <span className="min-w-0 grow">
            <TextField
              label={t('brokers.serial.console.input', 'Send')}
              isLabelHidden
              value={input}
              className="font-mono"
              placeholder={
                view === 'hex'
                  ? t('brokers.serial.console.hexPlaceholder', 'Bytes in hex: 3a 31 35 34')
                  : t('brokers.serial.console.textPlaceholder', 'Text to send')
              }
              onChange={(event) => {
                setInput(event.target.value);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && input !== '' && consoleId !== null) {
                  send.mutate();
                }
              }}
            />
          </span>
          <span className="flex items-center gap-2">
            <SelectField
              label={t('brokers.serial.console.ending', 'Line ending')}
              isLabelHidden
              value={ending}
              onChange={(value) => {
                setEnding(value === 'none' || value === 'crlf' ? value : 'lf');
              }}
              className="w-28"
              options={[
                { value: 'none', label: t('brokers.serial.console.none', 'None') },
                { value: 'lf', label: t('brokers.serial.console.lf', 'LF') },
                { value: 'crlf', label: t('brokers.serial.console.crlf', 'CRLF') },
              ]}
            />
            <Button
              disabled={input === '' || consoleId === null}
              isBusy={send.isPending}
              onClick={() => {
                send.mutate();
              }}
            >
              <AppIcon id="send" size={15} />
              {t('brokers.serial.console.send', 'Send')}
            </Button>
          </span>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <Note tone="warning">
          {t(
            'brokers.serial.console.held',
            'The port is held by the console while this is open. Nobody else can use it until you close it.',
          )}
        </Note>
        <div className="flex flex-wrap items-center gap-3">
          <Segmented
            label={t('brokers.serial.console.view', 'View')}
            value={view}
            onChange={setView}
            options={[
              { value: 'text', label: t('brokers.serial.console.text', 'Text') },
              { value: 'hex', label: t('brokers.serial.console.hex', 'Hex') },
            ]}
          />
          <SelectField
            label={t('brokers.serial.line.baud', 'Baud rate')}
            isLabelHidden
            value={String(line.baudRate)}
            className="w-40"
            onChange={(value) => {
              setChunks([]);
              cursor.current = undefined;
              setLine({ ...line, baudRate: Number(value) });
            }}
            options={SERIAL_BAUD_RATES.map((rate) => ({
              value: String(rate),
              label: serialLineText({ ...line, baudRate: rate }),
            }))}
          />
          <span className="grow" />
          <Button
            variant="ghost"
            size="compact"
            onClick={() => {
              setPaused(!isPaused);
            }}
          >
            <AppIcon id={isPaused ? 'play' : 'pause'} size={14} />
            {isPaused
              ? t('brokers.serial.console.resume', 'Resume')
              : t('brokers.serial.console.pause', 'Pause')}
          </Button>
          <Button
            variant="bare"
            size="compact"
            onClick={() => {
              setChunks([]);
            }}
          >
            <AppIcon id="trash-2" size={14} />
            {t('brokers.serial.console.clear', 'Clear')}
          </Button>
        </div>
        <ol
          aria-live="polite"
          className="flex h-75 flex-col overflow-y-auto rounded-inner border border-border bg-rail px-4 py-3 font-mono text-mono-caption leading-relaxed"
        >
          {chunks.length === 0 ? (
            <li className="text-foreground-subtle">
              {open.isPending && props.sample === undefined
                ? t('brokers.serial.console.opening', 'Opening the port…')
                : t('brokers.serial.console.quiet', 'Nothing has crossed the port yet.')}
            </li>
          ) : (
            chunks.map((chunk) => (
              <li key={chunk.seq} className="flex gap-4 whitespace-pre">
                <span className="shrink-0 text-foreground-subtle">{clock(chunk.at)}</span>
                <span className={chunk.direction === 'out' ? 'text-primary' : 'text-foreground'}>
                  {view === 'hex'
                    ? (chunk.data.match(/../gu) ?? []).join(' ')
                    : hexToText(chunk.data)}
                </span>
              </li>
            ))
          )}
        </ol>
        {[open.error, send.error].map((error) =>
          error === null ? null : (
            <Note key={toMessage(error)} tone="danger">
              {toMessage(error)}
            </Note>
          ),
        )}
      </div>
    </Modal>
  );
}
