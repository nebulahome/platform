/**
 * The interface's own icons, by name.
 *
 * Every one is a catalogue icon: an id in `UI_ICON_IDS`, drawn by `AppIcon` from the bundled
 * lucide drawing until the catalogue has been asked, and from the catalogue's answer after.
 * Nothing here draws a shape. A new icon is an id added to the design system's set - which the
 * test there checks against the catalogue - and a wrapper here if a name reads better at the
 * call site than the id; a glyph drawn in a component is what this file replaced.
 *
 * The wrappers take what the old glyphs took - SVG attributes, `width` and `height` as strings
 * - so a call site sized `width="15"` keeps working, and the two that open and close carry
 * their `isOpen` as a rotation rather than a second drawing.
 */
import type { SVGProps } from 'react';

import { AppIcon, cn, type UiIconId } from '@nebula-home/ui';

/** What every icon accepts: SVG attributes, the element id aside, which names the icon here. */
export type IconProps = Omit<SVGProps<SVGSVGElement>, 'id'>;

/**
 * Reads the size a call site asked for, the way the old glyphs took it.
 *
 * @param props - The SVG attributes, `width` possibly among them.
 * @returns The pixel size.
 */
function sizeOf(props: IconProps): number {
  const width = props.width ?? props.height;

  return typeof width === 'number' ? width : Number.parseInt(width ?? '19', 10);
}

/**
 * Draws one interface icon by its catalogue id.
 *
 * @param id - Which icon.
 * @param props - What the call site passed.
 * @returns The icon.
 */
function icon(id: UiIconId, props: IconProps) {
  const { width, height, className, ...rest } = props;

  return <AppIcon id={id} size={sizeOf({ width, height })} className={className} {...rest} />;
}

/**
 * Four panes: the dashboards.
 *
 * @param props - SVG attributes.
 * @returns The icon.
 */
export function DashboardsIcon(props: IconProps) {
  return icon('layout-dashboard', props);
}

/**
 * Stacked books: the library.
 *
 * @param props - SVG attributes.
 * @returns The icon.
 */
export function LibraryIcon(props: IconProps) {
  return icon('library', props);
}

/**
 * A box: packages.
 *
 * @param props - SVG attributes.
 * @returns The icon.
 */
export function PackagesIcon(props: IconProps) {
  return icon('package', props);
}

/**
 * A cog: settings.
 *
 * @param props - SVG attributes.
 * @returns The icon.
 */
export function SettingsIcon(props: IconProps) {
  return icon('settings', props);
}

/**
 * A chevron: right when shut, down when open.
 *
 * @param props - SVG attributes, and whether the thing it belongs to is open.
 * @returns The icon.
 */
export function ChevronIcon(props: IconProps & { readonly isOpen: boolean }) {
  const { isOpen, className, ...rest } = props;

  return icon('chevron-down', {
    ...rest,
    className: cn('transition-transform', isOpen ? '' : '-rotate-90', className),
  });
}

/**
 * A chevron pointing back: the previous page of a row that scrolls.
 *
 * @param props - SVG attributes.
 * @returns The icon.
 */
export function ChevronLeftIcon(props: IconProps) {
  return icon('chevron-left', props);
}

/**
 * A chevron pointing on: the next page of a row that scrolls.
 *
 * @param props - SVG attributes.
 * @returns The icon.
 */
export function ChevronRightIcon(props: IconProps) {
  return icon('chevron-right', props);
}

/**
 * A padlock.
 *
 * @param props - SVG attributes.
 * @returns The icon.
 */
export function LockIcon(props: IconProps) {
  return icon('lock', props);
}

/**
 * A tick.
 *
 * @param props - SVG attributes.
 * @returns The icon.
 */
export function CheckIcon(props: IconProps) {
  return icon('check', props);
}

/**
 * A triangle with a mark in it.
 *
 * @param props - SVG attributes.
 * @returns The icon.
 */
export function WarningIcon(props: IconProps) {
  return icon('triangle-alert', props);
}

/**
 * A circle with an i in it.
 *
 * @param props - SVG attributes.
 * @returns The icon.
 */
export function InfoIcon(props: IconProps) {
  return icon('info', props);
}

/**
 * Two overlapping sheets: copy.
 *
 * @param props - SVG attributes.
 * @returns The icon.
 */
export function CopyIcon(props: IconProps) {
  return icon('copy', props);
}

/**
 * A caret: down when shut, up when open.
 *
 * @param props - SVG attributes, and whether the thing it belongs to is open.
 * @returns The icon.
 */
export function CaretIcon(props: IconProps & { readonly isOpen: boolean }) {
  const { isOpen, className, ...rest } = props;

  return icon('chevron-down', {
    ...rest,
    className: cn('transition-transform', isOpen ? 'rotate-180' : '', className),
  });
}

/**
 * An eye: the secret is shown.
 *
 * @param props - SVG attributes.
 * @returns The icon.
 */
export function EyeIcon(props: IconProps) {
  return icon('eye', props);
}

/**
 * An eye, struck through: the secret is hidden.
 *
 * @param props - SVG attributes.
 * @returns The icon.
 */
export function EyeOffIcon(props: IconProps) {
  return icon('eye-off', props);
}

/**
 * A globe: the internet.
 *
 * @param props - SVG attributes.
 * @returns The icon.
 */
export function GlobeIcon(props: IconProps) {
  return icon('globe', props);
}

/**
 * A feed mark: a broker that publishes.
 *
 * @param props - SVG attributes.
 * @returns The icon.
 */
export function MqttIcon(props: IconProps) {
  return icon('rss', props);
}

/**
 * Nodes on a wire: something asked over the network.
 *
 * @param props - SVG attributes.
 * @returns The icon.
 */
export function HttpIcon(props: IconProps) {
  return icon('network', props);
}

/**
 * The Bluetooth rune: devices reached over Bluetooth LE.
 *
 * @param props - SVG attributes.
 * @returns The icon.
 */
export function BluetoothIcon(props: IconProps) {
  return icon('bluetooth', props);
}

/**
 * A radio mast: devices reached over a Zigbee mesh.
 *
 * @param props - SVG attributes.
 * @returns The icon.
 */
export function ZigbeeIcon(props: IconProps) {
  return icon('radio-tower', props);
}

/**
 * Lines that narrow: a filter.
 *
 * @param props - SVG attributes.
 * @returns The icon.
 */
export function FilterIcon(props: IconProps) {
  return icon('list-filter', props);
}

/**
 * An arrow leaving a box: opens elsewhere.
 *
 * @param props - SVG attributes.
 * @returns The icon.
 */
export function ExternalLinkIcon(props: IconProps) {
  return icon('external-link', props);
}

/**
 * A spanner: configure.
 *
 * @param props - SVG attributes.
 * @returns The icon.
 */
export function WrenchIcon(props: IconProps) {
  return icon('wrench', props);
}

/**
 * A bolt: what the house does on its own.
 *
 * @param props - SVG attributes.
 * @returns The icon.
 */
export function ZapIcon(props: IconProps) {
  return icon('zap', props);
}

/**
 * A tag: the words an owner groups devices and entities by.
 *
 * @param props - SVG attributes.
 * @returns The icon.
 */
export function TagIcon(props: IconProps) {
  return icon('tag', props);
}

/**
 * A chip: the processor.
 *
 * @param props - SVG attributes.
 * @returns The icon.
 */
export function ProcessorIcon(props: IconProps) {
  return icon('cpu', props);
}

/**
 * A memory stick: the memory.
 *
 * @param props - SVG attributes.
 * @returns The icon.
 */
export function MemoryIcon(props: IconProps) {
  return icon('memory-stick', props);
}

/**
 * A drive: the disk.
 *
 * @param props - SVG attributes.
 * @returns The icon.
 */
export function DiskIcon(props: IconProps) {
  return icon('hard-drive', props);
}

/**
 * An arrow down into a tray: what the network brings in.
 *
 * @param props - SVG attributes.
 * @returns The icon.
 */
export function DownloadIcon(props: IconProps) {
  return icon('download', props);
}

/**
 * An arrow up out of a tray: what the network sends out.
 *
 * @param props - SVG attributes.
 * @returns The icon.
 */
export function UploadIcon(props: IconProps) {
  return icon('upload', props);
}

/**
 * A rack unit: the machine the platform runs on.
 *
 * @param props - SVG attributes.
 * @returns The icon.
 */
export function ServerIcon(props: IconProps) {
  return icon('server', props);
}
