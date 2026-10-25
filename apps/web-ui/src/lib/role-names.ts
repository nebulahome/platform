/**
 * The built-in roles by name, in the language the interface speaks.
 *
 * A role is stored with a name and a description in English, seeded with the database; the
 * interface names the built-in ones here instead, in the language it speaks, with the same English.
 * A role made by hand keeps the name and description somebody typed: those are theirs, not the
 * catalogue's.
 */
import { defineMessage, text, type Message } from '@/i18n/messages';

/** The roles the platform ships, by key, with the English the database was seeded with. */
const ROLES: Readonly<Record<string, { readonly name: Message; readonly description: Message }>> = {
  owner: {
    name: defineMessage('roles.owner.name', 'Owner'),
    description: defineMessage(
      'roles.owner.description',
      'Full control, including users and system settings',
    ),
  },
  admin: {
    name: defineMessage('roles.admin.name', 'Admin'),
    description: defineMessage(
      'roles.admin.description',
      'Everything except changing what roles grant',
    ),
  },
  member: {
    name: defineMessage('roles.member.name', 'Member'),
    description: defineMessage(
      'roles.member.description',
      'Control entities and apply scenes, read history',
    ),
  },
  guest: {
    name: defineMessage('roles.guest.name', 'Guest'),
    description: defineMessage(
      'roles.guest.description',
      'Control an explicit allow-list of entities',
    ),
  },
  service: {
    name: defineMessage('roles.service.name', 'Service'),
    description: defineMessage('roles.service.description', 'Machine identity for access tokens'),
  },
};

/**
 * A role's name.
 *
 * @param key - The role's key.
 * @param stored - The name the database holds, for a role made by hand. Without it - where only
 * the key is at hand, as on the session - the key is read as words: `family_2` is "Family 2".
 * @returns Its name.
 */
export function roleName(key: string, stored?: string | null): string {
  const role = ROLES[key];

  if (role !== undefined) {
    return text(role.name);
  }

  const words = key.replaceAll('_', ' ');

  return stored ?? `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
}

/**
 * A role's description.
 *
 * @param key - The role's key.
 * @param stored - The description the database holds, for a role made by hand.
 * @returns The description.
 */
export function roleDescription(key: string, stored: string | null): string {
  const role = ROLES[key];

  return role === undefined ? (stored ?? '') : text(role.description);
}
