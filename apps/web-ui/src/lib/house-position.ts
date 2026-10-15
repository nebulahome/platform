/**
 * Where the house stands, as two boxes a person can type in and as the map hands it over.
 *
 * The boxes hold text, because a person typing `45.` has typed nothing wrong yet; the position
 * is read from them when it is needed, and a half-typed or impossible one is refused with a
 * sentence rather than sent for the server to refuse.
 */
import { translate } from '@/i18n/messages';

/** Where the house stands. */
export type HousePosition = {
  readonly latitude: number;
  readonly longitude: number;
};

/** What the two boxes say: a position, none, or why neither. */
export type ParsedPosition =
  { readonly position: HousePosition | null } | { readonly problem: string };

/**
 * Reads one coordinate.
 *
 * @param text - What was typed.
 * @param limit - How far from zero it may be.
 * @returns The number, or null when it is not one within the limit.
 */
function coordinate(text: string, limit: number): number | null {
  const trimmed = text.trim();

  if (trimmed === '' || !/^-?\d+(?:\.\d+)?$/u.test(trimmed)) {
    return null;
  }

  const value = Number(trimmed);

  return Math.abs(value) <= limit ? value : null;
}

/**
 * Reads the two boxes.
 *
 * @param latitudeText - What the latitude box says.
 * @param longitudeText - What the longitude box says.
 * @returns The position, none for two blanks, or what is wrong.
 */
export function parsePosition(latitudeText: string, longitudeText: string): ParsedPosition {
  const isLatitudeBlank = latitudeText.trim() === '';
  const isLongitudeBlank = longitudeText.trim() === '';

  if (isLatitudeBlank && isLongitudeBlank) {
    return { position: null };
  }

  if (isLatitudeBlank || isLongitudeBlank) {
    return {
      problem: translate('home.position.both', 'A position needs both a latitude and a longitude.'),
    };
  }

  const latitude = coordinate(latitudeText, 90);

  if (latitude === null) {
    return {
      problem: translate(
        'home.position.latitude',
        'The latitude must be a number between -90 and 90.',
      ),
    };
  }

  const longitude = coordinate(longitudeText, 180);

  if (longitude === null) {
    return {
      problem: translate(
        'home.position.longitude',
        'The longitude must be a number between -180 and 180.',
      ),
    };
  }

  return { position: { latitude, longitude } };
}

/**
 * Writes a coordinate for its box.
 *
 * @param value - The coordinate, or null for none.
 * @returns What the box should say.
 */
export function positionText(value: number | null): string {
  return value === null ? '' : String(value);
}
