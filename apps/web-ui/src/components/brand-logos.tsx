/**
 * The marks of the brokers the platform runs.
 *
 * Not interface icons - those are catalogue ids (`icons.tsx`) - but someone else's marks, drawn
 * as they publish them, in their own colours: MQTT's purple (Simple Icons, `mqtt`), Matter's
 * symbol without its wordmark (the CSA's logo, public-domain text logo on Wikimedia Commons),
 * which is one colour and so takes the text's, Bluetooth's rune in its oval (Simple Icons,
 * `bluetooth`) and Thread's ring with its looped T, in the fuchsia the Matter map draws Thread in.
 * Modbus, Serial and Infrared have no mark of their own: each is a glyph in the same line style,
 * in its broker's colour - three linked boxes, a DB9 plug, a blaster with three arcs.
 */
import type { SVGProps } from 'react';

/** What a mark accepts: SVG attributes, sized by `width` and `height`. */
export type BrandLogoProps = Omit<SVGProps<SVGSVGElement>, 'id' | 'viewBox'>;

/**
 * The MQTT mark.
 *
 * @param props - SVG attributes.
 * @returns The mark.
 */
export function MqttLogo(props: BrandLogoProps) {
  return (
    <svg viewBox="0 0 24 24" fill="#660066" aria-hidden="true" {...props}>
      <path d="M10.657 23.994h-9.45A1.212 1.212 0 0 1 0 22.788v-9.18h.071c5.784 0 10.504 4.65 10.586 10.386Zm7.606 0h-4.045C14.135 16.246 7.795 9.977 0 9.942V6.038h.071c9.983 0 18.121 8.044 18.192 17.956Zm4.53 0h-.97C21.754 12.071 11.995 2.407 0 2.372v-1.16C0 .55.544.006 1.207.006h7.64C15.733 2.49 21.257 7.789 24 14.508v8.291c0 .663-.544 1.195-1.207 1.195ZM16.713.006h6.092A1.19 1.19 0 0 1 24 1.2v5.914c-.91-1.242-2.046-2.65-3.158-3.762C19.588 2.11 18.122.987 16.714.005Z" />
    </svg>
  );
}

/**
 * The mark of the house's Modbus client: Modbus has no logo of its own, so three linked boxes, a
 * client and the servers it asks, in the broker's cyan.
 *
 * @param props - SVG attributes.
 * @returns The mark.
 */
export function ModbusLogo(props: BrandLogoProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="#4fc3d9"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <rect x="16" y="16" width="6" height="6" rx="1" />
      <rect x="2" y="16" width="6" height="6" rx="1" />
      <rect x="9" y="2" width="6" height="6" rx="1" />
      <path d="M5 16v-3a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v3" />
      <path d="M12 12V8" />
    </svg>
  );
}

/**
 * The Matter symbol.
 *
 * @param props - SVG attributes.
 * @returns The mark.
 */
export function MatterLogo(props: BrandLogoProps) {
  return (
    <svg viewBox="0 -0.839 74.322 74.322" fill="currentColor" aria-hidden="true" {...props}>
      <path d="M65.715 32.905c-7.996 2.19-15.164 7.406-19.636 15.152s-5.407 16.568-3.306 24.587l7.835-4.526a23.9 23.9 0 0 1 1.105-11.836l18.309 10.569 4.303-2.487v-4.967L56.016 48.829a23.92 23.92 0 0 1 9.699-6.879zm-57.108 0v9.045a23.91 23.91 0 0 1 9.699 6.879L0 59.398v4.967l4.303 2.487 18.306-10.569c1.39 3.868 1.726 7.938 1.108 11.836l7.832 4.526c2.101-8.02 1.167-16.841-3.306-24.587A32.52 32.52 0 0 0 8.607 32.905zM37.161 0l-4.303 2.484v21.138c-4.046-.731-7.736-2.476-10.804-4.961l-7.838 4.522c5.895 5.83 14 9.429 22.946 9.429s17.051-3.599 22.946-9.429l-7.835-4.522a23.92 23.92 0 0 1-10.807 4.961V2.484z" />
    </svg>
  );
}

/**
 * The Bluetooth mark: the rune in its oval.
 *
 * @param props - SVG attributes.
 * @returns The mark.
 */
export function BluetoothLogo(props: BrandLogoProps) {
  return (
    <svg viewBox="0 0 24 24" fill="#5b9dff" aria-hidden="true" {...props}>
      <path d="M12 0C6.76 0 3.1484 2.4895 3.1484 12S6.76 24 12 24c5.24 0 8.8516-2.4895 8.8516-12S17.24 0 12 0zm-.7773 1.6816l6.2148 6.2149L13.334 12l4.1035 4.1035-6.2148 6.2149V14.125l-3.418 3.42-1.2422-1.2442L10.8515 12l-4.289-4.3008 1.2422-1.2441 3.418 3.4199V1.6816zm1.748 4.2442v3.9687l1.9844-1.9843-1.9844-1.9844zm0 8.1816v3.9668l1.9844-1.9844-1.9844-1.9824Z" />
    </svg>
  );
}

/**
 * The Thread mark: a ring, and the T whose bar loops back into its stem.
 *
 * @param props - SVG attributes.
 * @returns The mark.
 */
export function ThreadLogo(props: BrandLogoProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="#e879f9"
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <circle cx="12" cy="12" r="9.5" />
      <path d="M12 21.5V10" />
      <path d="M6.5 10h7.75a2.75 2.75 0 1 0-2.75-2.75V10" />
    </svg>
  );
}

/**
 * The Serial broker's glyph: a DB9 plug, its nine pins in two rows.
 *
 * @param props - SVG attributes.
 * @returns The glyph.
 */
export function SerialLogo(props: BrandLogoProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="#f0c27b"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M2.5 7.5h19l-2.2 9H4.7z" />
      <path d="M7.4 10.5h.01M9.7 10.5h.01M12 10.5h.01M14.3 10.5h.01M16.6 10.5h.01" />
      <path d="M8.5 13.5h.01M10.8 13.5h.01M13.2 13.5h.01M15.5 13.5h.01" />
    </svg>
  );
}

/**
 * The Infrared broker's glyph: a blaster, and three arcs going out of it.
 *
 * @param props - SVG attributes.
 * @returns The glyph.
 */
export function InfraredLogo(props: BrandLogoProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="#f7895c"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <rect x="2.5" y="6.5" width="8" height="11" rx="2" />
      <path d="M6.5 10.5h.01" />
      <path d="M13.5 9.5a2.5 2.5 0 0 1 0 5" />
      <path d="M16.5 7a6 6 0 0 1 0 10" />
      <path d="M19.5 4.5a9.5 9.5 0 0 1 0 15" />
    </svg>
  );
}
