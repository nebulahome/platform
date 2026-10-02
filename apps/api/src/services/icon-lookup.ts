/**
 * The icon catalogue, as far as a write of an icon id needs it: does the id name an icon.
 *
 * Devices and entities both carry an icon id the owner picked from the catalogue a moment ago,
 * so a miss is a bug or a stale page, and worth a refusal naming the field rather than a row
 * pointing at a drawing that does not exist.
 */
import { ValidationError } from '@nebulahome/contracts';

/** Whether an icon id names an icon. */
export type IconLookup = {
  readonly has: (id: string) => boolean;
};

/**
 * Refuses an icon the catalogue does not have.
 *
 * @param icons - The catalogue.
 * @param icon - The id.
 * @throws {ValidationError} Naming the field.
 */
export function checkIcon(icons: IconLookup, icon: string): void {
  if (!icons.has(icon)) {
    throw new ValidationError('The icon is not in the catalogue', {
      details: { issues: [{ path: 'icon', message: `No icon has the id ${icon}` }] },
    });
  }
}
