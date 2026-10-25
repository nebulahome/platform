/**
 * The settings tree: every page, the group it sits in, and who may open it.
 *
 * Arranged by whose answer a setting is. **Personal** is this account and this browser: nobody
 * else is affected and nobody needs a permission to change their own password. **Server** is the
 * installation: one answer everyone lives with, every page behind a permission.
 *
 * One table, so the tree, the breadcrumbs, the page headers, the search and the routes cannot
 * drift apart. A page nobody may open is not shown - a courtesy rather than a control: each route
 * checks the permission itself, because a hidden link is not a closed door.
 */
import type { UiIconId } from '@nebulahome/ui';

import { defineMessage, type Message } from '@/i18n/messages';

/** One page of the tree. */
export type SettingsPageEntry = {
  /** Its address. */
  readonly path: string;

  /** What it is called. */
  readonly label: Message;

  /** The one line under its title. */
  readonly description: Message;

  /** Its icon, in its header chip. */
  readonly icon: UiIconId;

  /** The permission needed to open it, or null when anyone signed in may. */
  readonly permission: string | null;
};

/** One entry of the tree: a page of its own (Personal), or a group of pages (Server). */
export type SettingsGroup = {
  /** A stable name. */
  readonly id: string;

  /** Whose answer its settings are. */
  readonly scope: 'personal' | 'server';

  /** What it is called. */
  readonly label: Message;

  /** Its icon in the tree. */
  readonly icon: UiIconId;

  /** True for a page on its own, drawn as a link rather than a group that opens. */
  readonly isLeaf: boolean;

  /** Its pages; a leaf has one. */
  readonly pages: readonly SettingsPageEntry[];
};

/** Every entry, in the order they read. */
export const SETTINGS_TREE: readonly SettingsGroup[] = [
  {
    id: 'account',
    scope: 'personal',
    label: defineMessage('settings.tree.account', 'Account & security'),
    icon: 'user-round',
    isLeaf: true,
    pages: [
      {
        path: '/settings/account',
        label: defineMessage('settings.tree.account', 'Account & security'),
        description: defineMessage('settings.pages.account', 'Your profile, sign-in and sessions.'),
        icon: 'user-round',
        permission: null,
      },
    ],
  },
  {
    id: 'interface',
    scope: 'personal',
    label: defineMessage('settings.tree.interface', 'Interface'),
    icon: 'app-window',
    isLeaf: true,
    pages: [
      {
        path: '/settings/interface',
        label: defineMessage('settings.tree.interface', 'Interface'),
        description: defineMessage('settings.pages.interface', 'How Nebula looks in this browser.'),
        icon: 'app-window',
        permission: null,
      },
    ],
  },
  {
    id: 'people',
    scope: 'server',
    label: defineMessage('settings.tree.people', 'People'),
    icon: 'users',
    isLeaf: false,
    pages: [
      {
        path: '/settings/people/users',
        label: defineMessage('settings.tree.users', 'Users'),
        description: defineMessage('settings.pages.users', 'Who can sign in to this house.'),
        icon: 'users',
        permission: 'user:read',
      },
      {
        path: '/settings/people/roles',
        label: defineMessage('settings.tree.roles', 'Roles'),
        description: defineMessage(
          'settings.pages.roles',
          'What each role allows. Each person has one.',
        ),
        icon: 'shield',
        permission: 'user:read',
      },
    ],
  },
  {
    id: 'system',
    scope: 'server',
    label: defineMessage('settings.tree.system', 'System'),
    icon: 'server',
    isLeaf: false,
    pages: [
      {
        path: '/settings/system/monitor',
        label: defineMessage('settings.tree.monitor', 'Monitor'),
        description: defineMessage(
          'settings.pages.monitor',
          'The machine Nebula Home runs on, live.',
        ),
        icon: 'activity',
        permission: 'system:read',
      },
      {
        path: '/settings/system/maintenance',
        label: defineMessage('settings.tree.maintenance', 'Maintenance'),
        description: defineMessage('settings.pages.maintenance', 'Updates, restart and shut down.'),
        icon: 'download',
        permission: 'system:read',
      },
      {
        path: '/settings/system/backup',
        label: defineMessage('settings.tree.backup', 'Backup'),
        description: defineMessage(
          'settings.pages.backup',
          'Copies of your setup, ready to restore.',
        ),
        icon: 'hard-drive',
        permission: 'settings:read',
      },
    ],
  },
  {
    id: 'data',
    scope: 'server',
    label: defineMessage('settings.tree.data', 'Data'),
    icon: 'database',
    isLeaf: false,
    pages: [
      {
        path: '/settings/data/retention',
        label: defineMessage('settings.tree.retention', 'Retention'),
        description: defineMessage(
          'settings.pages.retention',
          'How long history is kept, and house-wide defaults.',
        ),
        icon: 'database',
        permission: 'settings:read',
      },
    ],
  },
  {
    id: 'network',
    scope: 'server',
    label: defineMessage('settings.tree.network', 'Network'),
    icon: 'network',
    isLeaf: false,
    pages: [
      {
        path: '/settings/network/webhooks',
        label: defineMessage('settings.tree.webhooks', 'Webhooks'),
        description: defineMessage(
          'settings.pages.webhooks',
          'Start automations from other apps with a web call.',
        ),
        icon: 'webhook',
        permission: 'settings:read',
      },
    ],
  },
  {
    id: 'customise',
    scope: 'server',
    label: defineMessage('settings.tree.customise', 'Customise'),
    icon: 'palette',
    isLeaf: false,
    pages: [
      {
        path: '/settings/customise/icons',
        label: defineMessage('settings.tree.icons', 'Icons'),
        description: defineMessage('settings.pages.icons', 'The icons used across Nebula.'),
        icon: 'palette',
        permission: 'settings:read',
      },
    ],
  },
];

/** Where somebody who opens `/settings` with nothing more specific in mind ends up. */
export const DEFAULT_SETTINGS_PAGE = '/settings/account';

/**
 * Finds the page an address belongs to: its own, or the one it sits under (Recent calls is under
 * Webhooks).
 *
 * @param path - The address.
 * @returns The page and its group, or undefined outside the tree.
 */
export function settingsPageAt(
  path: string,
): { readonly group: SettingsGroup; readonly page: SettingsPageEntry } | undefined {
  for (const group of SETTINGS_TREE) {
    for (const page of group.pages) {
      if (path === page.path || path.startsWith(`${page.path}/`)) {
        return { group, page };
      }
    }
  }

  return undefined;
}

/**
 * The tree as far as somebody may open it: pages they lack the permission for left out, and
 * groups left with none left out with them.
 *
 * @param can - Whether the person holds a permission.
 * @returns The reachable tree.
 */
export function reachableTree(can: (permission: string) => boolean): SettingsGroup[] {
  return SETTINGS_TREE.map((group) => ({
    ...group,
    pages: group.pages.filter((page) => page.permission === null || can(page.permission)),
  })).filter((group) => group.pages.length > 0);
}
