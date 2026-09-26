/**
 * The house the energy card draws, in the style the card was given.
 *
 * Nothing on it depends on the meters: the panels, the battery and the wires are drawn over it,
 * each only when the card has what it shows. A flat-roofed house has a front of its own - the
 * parapet the panels stand behind - drawn after them by {@link HouseFront}.
 */
import { FlatHouse, FlatHouseFront } from '@/routes/dashboard/cards/energy/flat-house';
import { GableHouse } from '@/routes/dashboard/cards/energy/gable-house';
import type { HouseGeometry } from '@/routes/dashboard/cards/energy/geometry';

/** What the house needs. */
export type HouseProps = {
  readonly geometry: HouseGeometry;
};

/**
 * Renders the house.
 *
 * @param props - See {@link HouseProps}.
 * @returns The group.
 */
export function House(props: HouseProps) {
  const { geometry } = props;

  return geometry.roof === 'flat' ? (
    <FlatHouse geometry={geometry} />
  ) : (
    <GableHouse geometry={geometry} />
  );
}

/**
 * Renders what of the house stands in front of the panels: a flat roof's parapet, and nothing on
 * a pitched roof, whose panels lie on the slope facing the viewer.
 *
 * @param props - See {@link HouseProps}.
 * @returns The group, or nothing.
 */
export function HouseFront(props: HouseProps) {
  const { geometry } = props;

  return geometry.roof === 'flat' ? <FlatHouseFront geometry={geometry} /> : null;
}
