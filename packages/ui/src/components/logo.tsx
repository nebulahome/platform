/**
 * The Nebula mark.
 *
 * A ring with a bite taken out of it and two bodies on the orbit. Drawn rather than imported as
 * an asset so that it inherits the accent token: the mark and the interface change colour
 * together, and a themed page never shows a logo from the other theme.
 */
import { cn } from '../lib/cn.js';

/** What the mark needs to be drawn. */
export type LogoProps = {
  /** Edge length in pixels. */
  readonly size?: number;

  /** Extra classes for the wrapper. */
  readonly className?: string;
};

/**
 * Draws the mark.
 *
 * @param props - See {@link LogoProps}.
 * @returns The logo.
 */
export function Logo(props: LogoProps) {
  const { size = 28, className } = props;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 120 120"
      role="img"
      aria-label="Nebula Home"
      className={cn('shrink-0', className)}
    >
      <defs>
        {/*
         * The bite. Masking a filled rectangle rather than drawing an arc keeps the stroke width
         * even all the way round, which a path with a gap does not.
         */}
        <mask id="nebula-orbit">
          <rect width="120" height="120" fill="#000" />
          <circle cx="60" cy="60" r="52" fill="none" stroke="#fff" strokeWidth="7" />
          <circle cx="96.8" cy="23.2" r="18" fill="#000" />
        </mask>
      </defs>
      <rect
        width="120"
        height="120"
        fill="currentColor"
        mask="url(#nebula-orbit)"
        className="text-foreground"
      />
      <circle cx="60" cy="60" r="26" className="fill-primary" />
      <circle cx="96.8" cy="23.2" r="11.5" className="fill-primary" />
    </svg>
  );
}
