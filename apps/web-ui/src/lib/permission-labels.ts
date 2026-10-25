/**
 * What each permission is called in a list, and the group it is listed in.
 *
 * `permission-descriptions.ts` says what a permission lets somebody do, in a sentence; this is
 * the short name a row of the roles page shows beside its key ("See entities"), and the five
 * groups the page folds the catalogue into - by what a person is doing, not by the resource name
 * the API files it under. A permission this build does not know is listed under Administration
 * by its key, so a newer server's catalogue still shows whole.
 */
import { PERMISSIONS } from '@nebulahome/contracts';

import { defineMessage, text, type Message } from '@/i18n/messages';

/** Every permission's short name, by key. */
const LABELS: Readonly<Record<string, Message>> = {
  'entity:read': defineMessage('permissionLabels.entityRead', 'See entities'),
  'entity:control': defineMessage('permissionLabels.entityControl', 'Control entities'),
  'entity:write': defineMessage('permissionLabels.entityWrite', 'Rename and configure'),
  'entity:delete': defineMessage('permissionLabels.entityDelete', 'Remove entities'),
  'history:read': defineMessage('permissionLabels.historyRead', 'Read history'),
  'device:read': defineMessage('permissionLabels.deviceRead', 'See devices'),
  'device:write': defineMessage('permissionLabels.deviceWrite', 'Change devices'),
  'device:delete': defineMessage('permissionLabels.deviceDelete', 'Remove devices'),
  'area:read': defineMessage('permissionLabels.areaRead', 'See areas'),
  'area:write': defineMessage('permissionLabels.areaWrite', 'Change areas'),
  'tag:read': defineMessage('permissionLabels.tagRead', 'See tags'),
  'tag:write': defineMessage('permissionLabels.tagWrite', 'Change tags'),
  'automation:read': defineMessage('permissionLabels.automationRead', 'See automations'),
  'automation:trigger': defineMessage('permissionLabels.automationTrigger', 'Run automations'),
  'automation:write': defineMessage('permissionLabels.automationWrite', 'Write automations'),
  'scene:read': defineMessage('permissionLabels.sceneRead', 'See scenes'),
  'scene:apply': defineMessage('permissionLabels.sceneApply', 'Apply scenes'),
  'scene:write': defineMessage('permissionLabels.sceneWrite', 'Write scenes'),
  'alias:read': defineMessage('permissionLabels.aliasRead', 'See aliases'),
  'alias:write': defineMessage('permissionLabels.aliasWrite', 'Write aliases'),
  'dashboard:manage': defineMessage('permissionLabels.dashboardManage', 'Manage dashboards'),
  'integration:read': defineMessage('permissionLabels.integrationRead', 'See integrations'),
  'integration:configure': defineMessage(
    'permissionLabels.integrationConfigure',
    'Set up integrations',
  ),
  'integration:install': defineMessage(
    'permissionLabels.integrationInstall',
    'Install integrations',
  ),
  'package:read': defineMessage('permissionLabels.packageRead', 'See packages'),
  'package:install': defineMessage('permissionLabels.packageInstall', 'Install packages'),
  'package:configure': defineMessage('permissionLabels.packageConfigure', 'Configure packages'),
  'container:read': defineMessage('permissionLabels.containerRead', 'See containers'),
  'container:control': defineMessage('permissionLabels.containerControl', 'Control containers'),
  'container:install': defineMessage('permissionLabels.containerInstall', 'Install containers'),
  'system:read': defineMessage('permissionLabels.systemRead', 'System monitor'),
  'logs:read': defineMessage('permissionLabels.logsRead', 'Read logs'),
  'user:read': defineMessage('permissionLabels.userRead', 'See people'),
  'user:manage': defineMessage('permissionLabels.userManage', 'Manage people'),
  'role:manage': defineMessage('permissionLabels.roleManage', 'Change roles'),
  'settings:read': defineMessage('permissionLabels.settingsRead', 'Read settings'),
  'settings:write': defineMessage('permissionLabels.settingsWrite', 'Change settings'),
  'audit:read': defineMessage('permissionLabels.auditRead', 'Read the audit trail'),
  'backup:restore': defineMessage('permissionLabels.backupRestore', 'Restore backups'),
};

/** One group of the catalogue, as the roles page lists it. */
export type PermissionGroup = {
  /** A stable name. */
  readonly id: string;

  /** What it is called. */
  readonly label: Message;

  /** The keys in it, in the order they read. */
  readonly keys: readonly string[];
};

/** The groups, each by the resources it gathers, in the order they read. */
const GROUPS: readonly { id: string; label: Message; resources: readonly string[] }[] = [
  {
    id: 'entities',
    label: defineMessage('permissionGroups.entities', 'Entities and history'),
    resources: ['entity', 'history'],
  },
  {
    id: 'house',
    label: defineMessage('permissionGroups.house', 'House'),
    resources: ['device', 'area', 'tag'],
  },
  {
    id: 'automate',
    label: defineMessage('permissionGroups.automate', 'Automate'),
    resources: ['automation', 'scene', 'alias', 'dashboard'],
  },
  {
    id: 'system',
    label: defineMessage('permissionGroups.system', 'System'),
    resources: ['integration', 'package', 'container', 'system', 'logs'],
  },
  {
    id: 'administration',
    label: defineMessage('permissionGroups.administration', 'Administration'),
    resources: ['user', 'role', 'settings', 'audit', 'backup'],
  },
];

/** Every permission in the catalogue, folded into the groups. */
export const PERMISSION_GROUPS: readonly PermissionGroup[] = GROUPS.map((group, index) => ({
  id: group.id,
  label: group.label,
  keys: [
    ...group.resources.flatMap((resource) =>
      PERMISSIONS.filter((permission) => permission.resource === resource).map(
        (permission) => permission.key,
      ),
    ),
    // The last group takes whatever no group names, so nothing in the catalogue goes unlisted.
    ...(index === GROUPS.length - 1
      ? PERMISSIONS.filter(
          (permission) => !GROUPS.some((each) => each.resources.includes(permission.resource)),
        ).map((permission) => permission.key)
      : []),
  ],
}));

/** How many permissions the catalogue has. */
export const PERMISSION_COUNT = PERMISSIONS.length;

/**
 * A permission's short name.
 *
 * @param key - The permission.
 * @returns Its name in the interface's language, or the key itself when this build does not know it.
 */
export function permissionLabel(key: string): string {
  const label = LABELS[key];

  return label === undefined ? key : text(label);
}
