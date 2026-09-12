/**
 * The glyphs the rail and the settings pages need.
 *
 * Drawn here rather than pulled from an icon set, for the same reason the logo is: they are a
 * dozen shapes, they inherit `currentColor`, and they cost nothing at all. That is the whole
 * argument, and it stops holding somewhere around here - a page that needs a general icon
 * vocabulary should take a dependency on `lucide-react` rather than grow this file, and the
 * design system already has one to copy the dependency from.
 */
import type { SVGProps } from 'react';

/** What every glyph accepts. */
export type IconProps = SVGProps<SVGSVGElement>;

/**
 * The shared frame: a 24-unit box with a rounded, non-scaling stroke.
 *
 * @param props - The path data and any SVG attributes.
 * @returns The wrapped glyph.
 */
function Glyph(props: IconProps & { readonly children: React.ReactNode }) {
  const { children, ...rest } = props;

  return (
    <svg
      width="19"
      height="19"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  );
}

/**
 * Four panes: the dashboards.
 *
 * @param props - SVG attributes.
 * @returns The glyph.
 */
export function DashboardsIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <rect x="3.5" y="3.5" width="7.5" height="7.5" rx="2" />
      <rect x="13" y="3.5" width="7.5" height="7.5" rx="2" />
      <rect x="3.5" y="13" width="7.5" height="7.5" rx="2" />
      <rect x="13" y="13" width="7.5" height="7.5" rx="2" />
    </Glyph>
  );
}

/**
 * Stacked layers: the library.
 *
 * @param props - SVG attributes.
 * @returns The glyph.
 */
export function LibraryIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M12 3.2L21 7.7l-9 4.5-9-4.5z" />
      <path d="M3 12.2l9 4.5 9-4.5" />
      <path d="M3 16.6l9 4.5 9-4.5" />
    </Glyph>
  );
}

/**
 * A crate: the packages.
 *
 * @param props - SVG attributes.
 * @returns The glyph.
 */
export function PackagesIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M20.5 7.8v8.4l-8.5 4.6-8.5-4.6V7.8L12 3.2z" />
      <path d="M3.7 7.9l8.3 4.5 8.3-4.5" />
      <path d="M12 12.4v8.4" />
    </Glyph>
  );
}

/**
 * A cog: the settings.
 *
 * @param props - SVG attributes.
 * @returns The glyph.
 */
export function SettingsIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <circle cx="12" cy="12" r="3.2" />
      <path
        d="M19.4 14.5a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1v.3a2 2 0
        1 1-4 0v-.2a1.6 1.6 0 0 0-2.8-1.1l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0-1.1-2.7h-.3a2 2 0
        1 1 0-4h.2a1.6 1.6 0 0 0 1.1-2.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3 1.6 1.6 0 0 0
        1-1.5v-.3a2 2 0 1 1 4 0v.2a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0 1.1
        2.7h.3a2 2 0 1 1 0 4h-.2a1.6 1.6 0 0 0-1.4 1z"
      />
    </Glyph>
  );
}

/**
 * A chevron, pointing down when open and right when shut.
 *
 * @param props - Whether it is open, plus SVG attributes.
 * @returns The glyph.
 */
export function ChevronIcon(props: IconProps & { readonly isOpen: boolean }) {
  const { isOpen, ...rest } = props;

  return (
    <Glyph width="16" height="16" strokeWidth="2" {...rest}>
      <path d={isOpen ? 'M8 9.5l4 4 4-4' : 'M10 7.5l4 4-4 4'} />
    </Glyph>
  );
}

/**
 * The two arrowheads on the user chip, which open a menu upward or downward.
 *
 * @param props - SVG attributes.
 * @returns The glyph.
 */
export function ExpandIcon(props: IconProps) {
  return (
    <Glyph width="16" height="16" strokeWidth="2" {...props}>
      <path d="M8 9.5l4-4 4 4M8 14.5l4 4 4-4" />
    </Glyph>
  );
}

/**
 * A closed padlock: something behind a permission.
 *
 * @param props - SVG attributes.
 * @returns The glyph.
 */
export function LockIcon(props: IconProps) {
  return (
    <Glyph strokeWidth="2.4" {...props}>
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8.5 11V8a3.5 3.5 0 0 1 7 0v3" />
    </Glyph>
  );
}

/**
 * A tick: a protection that is on, or a thing that worked.
 *
 * @param props - SVG attributes.
 * @returns The glyph.
 */
export function CheckIcon(props: IconProps) {
  return (
    <Glyph strokeWidth="2.6" {...props}>
      <path d="M5 12.5l4.5 4.5L19 7" />
    </Glyph>
  );
}

/**
 * A triangle: a protection that is off. Not an error - nothing has gone wrong yet.
 *
 * @param props - SVG attributes.
 * @returns The glyph.
 */
export function WarningIcon(props: IconProps) {
  return (
    <Glyph strokeWidth="2.1" {...props}>
      <path d="M12 3.8L21 19.5H3z" />
      <path d="M12 10v3M12 16.3v.2" />
    </Glyph>
  );
}

/**
 * An `i` in a circle: something worth knowing before changing a setting.
 *
 * @param props - SVG attributes.
 * @returns The glyph.
 */
export function InfoIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 11v5.5M12 7.8v.2" />
    </Glyph>
  );
}

/**
 * Two overlapping sheets: copy this to the clipboard.
 *
 * @param props - SVG attributes.
 * @returns The glyph.
 */
export function CopyIcon(props: IconProps) {
  return (
    <Glyph width="15" height="15" {...props}>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5.5 15H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v.5" />
    </Glyph>
  );
}

/**
 * A caret: down when a list is closed, up when it is open.
 *
 * Distinct from {@link ChevronIcon}, which points right when shut because it marks a group that
 * expands downward in place. A dropdown is the other convention - down means "there is a list
 * under this" - and using the same glyph for both would make one of them read as the wrong
 * gesture.
 *
 * @param props - Whether the list is open, plus SVG attributes.
 * @returns The glyph.
 */
export function CaretIcon(props: IconProps & { readonly isOpen: boolean }) {
  const { isOpen, ...rest } = props;

  return (
    <Glyph width="16" height="16" strokeWidth="2" {...rest}>
      <path d={isOpen ? 'M8 13.5l4-4 4 4' : 'M8 10.5l4 4 4-4'} />
    </Glyph>
  );
}

/**
 * An open eye: the password is hidden, and pressing this shows it.
 *
 * Named for what the control does rather than for what it currently is, which is the same rule
 * the button's label follows.
 *
 * @param props - SVG attributes.
 * @returns The glyph.
 */
export function EyeIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M2.5 12s3.6-6 9.5-6 9.5 6 9.5 6-3.6 6-9.5 6-9.5-6-9.5-6z" />
      <circle cx="12" cy="12" r="2.6" />
    </Glyph>
  );
}

/**
 * The same eye, struck through: the password is showing, and pressing this hides it again.
 *
 * The stroke is a real second path rather than a rotated rule, so it keeps the round cap every
 * other glyph in the set has.
 *
 * @param props - SVG attributes.
 * @returns The glyph.
 */
export function EyeOffIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M10.6 6.2A9.6 9.6 0 0 1 12 6c5.9 0 9.5 6 9.5 6a17 17 0 0 1-2.9 3.5" />
      <path d="M6.4 8.2A16.7 16.7 0 0 0 2.5 12s3.6 6 9.5 6a9.4 9.4 0 0 0 3.6-.7" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
      <path d="M4 4l16 16" />
    </Glyph>
  );
}

/**
 * A globe: the devices behind this mark need the internet to work.
 *
 * @param props - SVG attributes.
 * @returns The glyph.
 */
export function GlobeIcon(props: IconProps) {
  return (
    <Glyph strokeWidth="2" {...props}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M3.5 12h17" />
      <path d="M12 3.5c2.6 2.6 3.9 5.4 3.9 8.5S14.6 17.9 12 20.5c-2.6-2.6-3.9-5.4-3.9-8.5S9.4 6.1 12 3.5z" />
    </Glyph>
  );
}

/**
 * Broadcast arcs: the vendor is listened to on the MQTT broker.
 *
 * @param props - SVG attributes.
 * @returns The glyph.
 */
export function MqttIcon(props: IconProps) {
  return (
    <Glyph strokeWidth="2" {...props}>
      <path d="M4 5.5a14.5 14.5 0 0 1 14.5 14.5" />
      <path d="M4 11.5a8.5 8.5 0 0 1 8.5 8.5" />
      <circle cx="5.5" cy="18.5" r="1.6" />
    </Glyph>
  );
}

/**
 * Two arrows, request and reply: the vendor's devices are spoken to over HTTP.
 *
 * @param props - SVG attributes.
 * @returns The glyph.
 */
export function HttpIcon(props: IconProps) {
  return (
    <Glyph strokeWidth="2" {...props}>
      <path d="M4 8.5h14l-3.5-3.5" />
      <path d="M20 15.5H6l3.5 3.5" />
    </Glyph>
  );
}

/**
 * A funnel: narrow what is listed.
 *
 * @param props - SVG attributes.
 * @returns The glyph.
 */
export function FilterIcon(props: IconProps) {
  return (
    <Glyph strokeWidth="2" {...props}>
      <path d="M3.5 5h17l-6.5 8v5.5l-4 2v-7.5z" />
    </Glyph>
  );
}

/**
 * An arrow leaving a box: the link opens somewhere else.
 *
 * @param props - SVG attributes.
 * @returns The glyph.
 */
export function ExternalLinkIcon(props: IconProps) {
  return (
    <Glyph strokeWidth="2" {...props}>
      <path d="M14 4.5h5.5V10" />
      <path d="M19.5 4.5L11 13" />
      <path d="M17 13.5v5a1 1 0 0 1-1 1H5.5a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1h5" />
    </Glyph>
  );
}
