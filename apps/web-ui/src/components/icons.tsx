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
