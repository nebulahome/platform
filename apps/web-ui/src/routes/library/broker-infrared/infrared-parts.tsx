/**
 * Pieces the Infrared broker's pages share: a remote's kind as a word and a glyph, the square a
 * remote is known by, a blaster as a tag, what a blaster can do as chips, and a code's protocol
 * as a Pill and a line.
 */
import { useTranslation } from 'react-i18next';

import type {
  InfraredBlaster,
  InfraredCode,
  InfraredRemoteKind,
  InfraredProtocol,
} from '@nebulahome/contracts';
import { AppIcon, cn, Pill, type UiIconId } from '@nebulahome/ui';

import { translate } from '@/i18n/messages';
import { CapabilityChip } from '@/routes/library/broker-parts';

/** The broker's colour, as text: the glyph's orange. */
export const INFRARED_TEXT = 'text-[#f7895c]';

/** The glyph of each kind of remote. */
export const KIND_ICONS: Readonly<Record<InfraredRemoteKind, UiIconId>> = {
  tv: 'tv',
  'air-conditioner': 'air-vent',
  fan: 'fan',
  audio: 'speaker',
  light: 'lightbulb',
  other: 'circle-dot',
};

/**
 * A kind of remote in words.
 *
 * @param kind - The kind.
 * @returns Its name.
 */
export function kindName(kind: InfraredRemoteKind): string {
  switch (kind) {
    case 'tv':
      return translate('brokers.infrared.kind.tv', 'TV');
    case 'air-conditioner':
      return translate('brokers.infrared.kind.airConditioner', 'Air conditioner');
    case 'fan':
      return translate('brokers.infrared.kind.fan', 'Fan');
    case 'audio':
      return translate('brokers.infrared.kind.audio', 'Audio');
    case 'light':
      return translate('brokers.infrared.kind.light', 'Light');
    case 'other':
      return translate('brokers.infrared.kind.other', 'Other');
  }
}

/**
 * The square a remote is known by: its kind's glyph in the broker's orange.
 *
 * @param props - The kind and the square's size.
 * @param props.kind - The remote's kind.
 * @param props.size - The side, as a size class; `size-9` when not said.
 * @param props.className - The caller's classes.
 * @returns The square.
 */
export function KindMark(props: {
  readonly kind: InfraredRemoteKind;
  readonly size?: string;
  readonly className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'flex shrink-0 items-center justify-center rounded-field bg-surface-raised',
        INFRARED_TEXT,
        props.size ?? 'size-9',
        props.className,
      )}
    >
      <AppIcon id={KIND_ICONS[props.kind]} size={16} />
    </span>
  );
}

/**
 * What a blaster can do: IR, RF 433, and whether it receives (learns).
 *
 * @param props - The blaster.
 * @param props.blaster - It.
 * @returns The chips.
 */
export function BlasterChips(props: { readonly blaster: InfraredBlaster }) {
  const { t } = useTranslation();
  const { blaster } = props;

  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {blaster.signals.map((signal) => (
        <span
          key={signal}
          className={cn(
            'inline-flex h-5.5 items-center rounded-pill border border-[#f7895c]/45 bg-[#f7895c]/10 px-2 text-caption whitespace-nowrap',
            INFRARED_TEXT,
          )}
        >
          {signal === 'ir' ? t('brokers.infrared.ir', 'IR') : t('brokers.infrared.rf433', 'RF 433')}
        </span>
      ))}
      {blaster.receives ? (
        <CapabilityChip>{t('brokers.infrared.receives', 'Receives')}</CapabilityChip>
      ) : null}
    </span>
  );
}

/**
 * A protocol's short name, as its Pill says it.
 *
 * @param protocol - The protocol, or none for a raw code.
 * @returns `NEC`, `Samsung`, `Sony`, `RC5` or `Raw`.
 */
export function protocolName(protocol: InfraredProtocol | null | undefined): string {
  switch (protocol?.name) {
    case 'nec':
    case 'nec-ext':
      return 'NEC';
    case 'samsung32':
      return 'Samsung';
    case 'sirc':
    case 'sirc15':
    case 'sirc20':
      return 'Sony';
    case 'rc5':
      return 'RC5';
    case undefined:
      return translate('brokers.infrared.raw', 'Raw');
  }
}

/**
 * A code's protocol as a Pill: a decoded one in the broker's colour, a raw one plain.
 *
 * @param props - The protocol.
 * @param props.protocol - It, or none for raw.
 * @returns The Pill.
 */
export function ProtocolPill(props: { readonly protocol: InfraredProtocol | null | undefined }) {
  return props.protocol == null ? (
    <Pill>{protocolName(null)}</Pill>
  ) : (
    <span
      className={cn(
        'inline-flex h-5.5 items-center rounded-pill border border-[#f7895c]/45 bg-[#f7895c]/10 px-2 text-caption font-medium',
        INFRARED_TEXT,
      )}
    >
      {protocolName(props.protocol)}
    </span>
  );
}

/**
 * A byte as hex: `0x04`.
 *
 * @param value - The number.
 * @returns The text.
 */
function hex(value: number): string {
  return `0x${value.toString(16).padStart(2, '0')}`;
}

/**
 * What a decoded code is: `address 0x04 · command 0x02`, or empty for a raw one.
 *
 * @param protocol - Its protocol.
 * @returns The line.
 */
export function protocolLine(protocol: InfraredProtocol | null | undefined): string {
  return protocol == null
    ? ''
    : translate('brokers.infrared.addressCommand', 'address {{address}} · command {{command}}', {
        address: hex(protocol.address),
        command: hex(protocol.command),
      });
}

/**
 * How a code is sent, in figures: `68 pulses · 38 kHz · 67.5 ms`.
 *
 * @param code - The code.
 * @returns The line.
 */
export function pulsesLine(code: InfraredCode): string {
  const ms = code.pulses.reduce((sum, pulse) => sum + pulse, 0) / 1000;
  const carrier =
    code.signal === 'rf'
      ? `${((code.frequencyHz ?? 433_920_000) / 1_000_000).toFixed(2)} MHz`
      : `${String(Math.round(code.carrierHz / 1000))} kHz`;

  return translate('brokers.infrared.pulsesLine', '{{count}} pulses · {{carrier}} · {{ms}} ms', {
    count: code.pulses.length,
    carrier,
    ms: Math.round(ms * 10) / 10,
  });
}
