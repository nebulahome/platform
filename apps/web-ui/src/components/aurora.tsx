/**
 * Three lights behind the sign-in screen.
 *
 * Each is a soft circle blurred far past recognition and moved very slowly - a full loop takes
 * between three quarters of a minute and a minute and a quarter. The three periods are coprime,
 * so the arrangement never comes back round to where it started and the screen never looks like
 * it is repeating.
 *
 * It is decoration and it says so: `aria-hidden`, no interaction, and the whole thing stops for
 * anyone whose system asks for less motion.
 *
 * The blur is large - 120 pixels - which is what makes three circles read as light rather than
 * as three circles. `will-change` is deliberately absent: promoting a 700-pixel blurred layer
 * costs more than the compositor saves, and on a wall-mounted tablet running this all day it is
 * the difference between a warm device and a hot one.
 */

/** One light: its colour, where it starts, and which drift it follows. */
type Light = {
  /** The token it is painted with. */
  readonly colour: string;

  /** Where it sits before it starts moving. */
  readonly position: string;

  /** Which of the three loops it runs. */
  readonly drift: string;
};

/**
 * The three, in the order they are painted.
 *
 * Sizes are in viewport width so the arrangement holds its proportions on a phone and on a wall
 * panel, rather than becoming three dots on one and three walls of colour on the other.
 */
const LIGHTS: readonly Light[] = [
  {
    colour: 'bg-aurora-one/25',
    position: '-top-[18vh] -left-[10vw] size-[62vw] min-size-95',
    drift: 'animate-drift-one',
  },
  {
    colour: 'bg-aurora-two/20',
    position: 'top-[38vh] -right-[14vw] size-[54vw] min-size-85',
    drift: 'animate-drift-two',
  },
  {
    colour: 'bg-aurora-three/15',
    position: '-bottom-[22vh] left-[22vw] size-[48vw] min-size-75',
    drift: 'animate-drift-three',
  },
];

/**
 * Renders the background.
 *
 * @returns The lights.
 */
export function Aurora() {
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 overflow-hidden">
      {LIGHTS.map((light) => (
        <div
          key={light.drift}
          className={`absolute rounded-full blur-[120px] ${light.colour} ${light.position} ${light.drift}`}
        />
      ))}
    </div>
  );
}
