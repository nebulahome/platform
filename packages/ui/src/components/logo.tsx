/**
 * The Nebula mark.
 *
 * The geometry is the supplied artwork, unchanged: a ring of radius 52 at stroke 7, a bite taken
 * out of it at (96.8, 23.2), a body of radius 26 at the centre and one of radius 11.5 sitting in
 * the bite. The bite is cut with a mask rather than drawn as a gapped arc, which is what keeps
 * the stroke an even width all the way round.
 *
 * The two colours are the only departure, and they are tokens rather than the artwork's `#FFF`
 * and `#6E7BFF`. In the dark theme they resolve to almost exactly those values; in the light one
 * a white ring on a white card would be an invisible logo.
 */
import { cn } from '../lib/cn.js';

/** What the mark needs to be drawn. */
export type LogoProps = {
  /** Edge length in pixels. */
  readonly size?: number;

  /**
   * Turns the mark, once every 1.6 seconds.
   *
   * The whole mark turns, not the outer body on its own: the ring's notch has to travel with the
   * body that sits in it, or the logo comes apart instead of spinning.
   */
  readonly isSpinning?: boolean;

  /**
   * Nebula Home working on itself - restarting, updating: the ring turns slowly and unevenly while
   * the core breathes, out of phase.
   */
  readonly isWorking?: boolean;

  /** The bodies' colour: the brand's, or the danger one when something did not finish. */
  readonly tone?: 'primary' | 'danger';

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
  const { size = 28, isSpinning = false, isWorking = false, tone = 'primary', className } = props;
  const body = tone === 'danger' ? 'fill-danger' : 'fill-primary';

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 120 120"
      role="img"
      // The product's name, the same in every language.
      // eslint-disable-next-line nebula/no-untranslated-text -- see above
      aria-label="Nebula Home"
      className={cn('shrink-0 overflow-visible', className)}
    >
      <defs>
        <mask id="nebula-orbit">
          <rect width="120" height="120" fill="#000" />
          <circle cx="60" cy="60" r="52" fill="none" stroke="#fff" strokeWidth="7" />
          <circle cx="96.8" cy="23.2" r="18" fill="#000" />
        </mask>
      </defs>

      {/*
       * The centre body is outside the turning group. It is concentric with the rotation, so
       * turning it would be work with nothing to show for it - and leaving it still is what
       * makes the orbit read as one thing going round another.
       */}
      <circle
        cx="60"
        cy="60"
        r="26"
        className={cn(body, isWorking && 'origin-view-box animate-breathe')}
      />

      <g
        className={cn(
          'origin-view-box',
          isSpinning && 'animate-orbit',
          isWorking && 'animate-orbit-work',
        )}
      >
        <rect width="120" height="120" mask="url(#nebula-orbit)" className="fill-foreground" />
        <circle cx="96.8" cy="23.2" r="11.5" className={body} />
      </g>
    </svg>
  );
}
