/**
 * The official marks of the two brokers the platform runs, MQTT and Matter.
 *
 * Not interface icons - those are catalogue ids (`icons.tsx`) - but someone else's marks, drawn
 * as they publish them, in their own colours: MQTT's purple (Simple Icons, `mqtt`), and Matter's
 * symbol without its wordmark (the CSA's logo, public-domain text logo on Wikimedia Commons),
 * which is one colour and so takes the text's.
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
