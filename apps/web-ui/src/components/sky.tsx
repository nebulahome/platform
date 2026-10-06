/**
 * The sky behind the sign-in and first-run screens: the welcome, never the ground of a working
 * screen.
 *
 * Three layers over `canvas` - far clouds, near clouds, stars - each drifting on its own slow
 * loop there and back, then a vignette to `canvas` so the card stands on quiet ground. The layers
 * are pictures (`assets/sky`, from the design) that carry their own colours: decorative art, the
 * one kind of drawing RULES.md 15.4 lets the interface hold.
 *
 * In the light theme the same layers become Dawn - the night sky a few hours later: lit lavender
 * to peach, the clouds multiplied and desaturated, the last stars fading out up high, a warm glow
 * below. The theme's own selectors decide it (`styles/globals.css`), so the sky follows the
 * interface's theme without a prop. Reduced motion stops the drift and keeps the picture.
 */
import cloudsFar from '@/assets/sky/nebula-clouds-far.svg';
import cloudsNear from '@/assets/sky/nebula-clouds-near.svg';
import stars from '@/assets/sky/nebula-stars.svg';

/**
 * Renders the sky.
 *
 * @returns The layers, behind everything and out of reach of the pointer and screen readers.
 */
export function Sky() {
  return (
    <div aria-hidden="true" className="sky pointer-events-none fixed inset-0 overflow-hidden">
      <img alt="" src={cloudsFar} className="sky-cloud sky-far animate-sky-far" />
      <img alt="" src={cloudsNear} className="sky-cloud sky-near animate-sky-near" />
      <img
        alt=""
        src={stars}
        className="sky-stars absolute inset-0 size-full animate-sky-stars object-cover"
      />
      <div className="sky-sunrise" />
      <div className="sky-vignette absolute inset-0" />
    </div>
  );
}
