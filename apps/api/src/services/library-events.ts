/**
 * Which part of the library an edit changed, read from the audit entry every edit already writes.
 *
 * Taken from the action, never from the kind of resource alone: signing in is recorded against a
 * user, and announcing every sign-in and token refresh as accounts changed would have every open
 * browser refresh its own token - and be recorded, and announce it again.
 */
import type { LibraryKind } from '@nebulahome/contracts';

/**
 * The actions, by their `resource.` prefix, whose success changes a part of the library. What is
 * left out has an event of its own (`package.`, `backup.run`), changes nothing a list shows
 * (`entity.command`, `scene.apply`, `automation.trigger`, `area.map.fetch`), or is the person's
 * own business (`auth.`, `token.`).
 */
const PREFIXES: readonly (readonly [prefix: string, kind: LibraryKind])[] = [
  ['area.', 'areas'],
  ['tag.', 'tags'],
  ['entity.', 'entities'],
  ['device.', 'devices'],
  ['scene.', 'scenes'],
  ['alias.', 'aliases'],
  ['automation.', 'automations'],
  ['dashboard.', 'dashboards'],
  ['user.', 'people'],
  ['role.', 'people'],
  ['settings.', 'settings'],
  ['icon.', 'icons'],
  ['backup_location.', 'backups'],
  ['integration.', 'vendors'],
];

/** Actions under those prefixes that change nothing another page lists. */
const UNCHANGING = new Set([
  'entity.command',
  'scene.apply',
  'automation.trigger',
  'area.map.fetch',
  'user.password_change',
]);

/**
 * The part of the library an action changed.
 *
 * @param action - The audit action, `resource.verb`.
 * @returns The part, or null when it changed none that is announced.
 */
export function libraryKindOf(action: string): LibraryKind | null {
  if (UNCHANGING.has(action)) {
    return null;
  }

  return PREFIXES.find(([prefix]) => action.startsWith(prefix))?.[1] ?? null;
}
