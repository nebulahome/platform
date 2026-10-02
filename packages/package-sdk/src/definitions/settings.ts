/**
 * `defineSettings`: what the owner configures on a package (PACKAGES_DOCS.md 4.2).
 *
 * The build writes them as the package's `setup.json`, in the grammar a vendor's settings use, so
 * the platform's Configure dialog asks them; the package's own interface may show and change
 * them too.
 */
import type { FormValues, Fields, SettingField } from '../fields.js';

/** A package's settings. */
export type SettingsDefinition<TFields extends Fields<SettingField> = Fields<SettingField>> = {
  readonly kind: 'settings';
  readonly fields: TFields;
};

/** The values of a package's settings: what has a default or is required is always there. */
export type SettingsOf<TSettings> =
  TSettings extends SettingsDefinition<infer TFields> ? FormValues<TFields> : never;

/* @__NO_SIDE_EFFECTS__ */
/**
 * Declares a package's settings, at most 64 fields, by their keys.
 *
 * @param fields - The fields, built with `field`.
 * @returns The settings, for `definePackage` and for the types of `ctx.settings`.
 */
export function defineSettings<const TFields extends Fields<SettingField>>(
  fields: TFields,
): SettingsDefinition<TFields> {
  return { kind: 'settings', fields };
}
