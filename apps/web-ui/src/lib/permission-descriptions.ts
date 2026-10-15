/**
 * What each permission lets somebody do, in the language the interface speaks.
 *
 * The catalogue in `@nebulahome/contracts` describes each permission in English for the API and
 * the database; the interface says the same thing here, by key, so the roles and the tokens pages
 * read in the language of whoever opens them. A key this build does not know reads as the
 * catalogue's English.
 */
import { PERMISSIONS } from '@nebulahome/contracts';

import { defineMessage, text, type Message } from '@/i18n/messages';

/** Every permission's description, by key. */
const DESCRIPTIONS: Readonly<Record<string, Message>> = {
  'entity:read': defineMessage('permissions.entityRead', 'See entities and their current state'),
  'entity:control': defineMessage('permissions.entityControl', 'Send commands to entities'),
  'entity:write': defineMessage(
    'permissions.entityWrite',
    'Rename entities and change their configuration',
  ),
  'entity:delete': defineMessage('permissions.entityDelete', 'Remove entities from the registry'),
  'device:read': defineMessage('permissions.deviceRead', 'See devices and how they are connected'),
  'device:write': defineMessage(
    'permissions.deviceWrite',
    'Pair devices, rename them and assign them to areas',
  ),
  'device:delete': defineMessage('permissions.deviceDelete', 'Unpair and remove devices'),
  'area:read': defineMessage('permissions.areaRead', 'See the area hierarchy'),
  'area:write': defineMessage('permissions.areaWrite', 'Create, rename and rearrange areas'),
  'tag:read': defineMessage('permissions.tagRead', 'See tags'),
  'tag:write': defineMessage('permissions.tagWrite', 'Create, rename, recolour and delete tags'),
  'automation:read': defineMessage(
    'permissions.automationRead',
    'See automations and their run history',
  ),
  'automation:write': defineMessage(
    'permissions.automationWrite',
    'Create, edit, enable and delete automations',
  ),
  'automation:trigger': defineMessage(
    'permissions.automationTrigger',
    'Run an automation manually',
  ),
  'scene:read': defineMessage('permissions.sceneRead', 'See scenes'),
  'scene:apply': defineMessage('permissions.sceneApply', 'Apply a scene'),
  'scene:write': defineMessage('permissions.sceneWrite', 'Create, edit and delete scenes'),
  'alias:read': defineMessage(
    'permissions.aliasRead',
    'See derived entities and their definitions',
  ),
  'alias:write': defineMessage(
    'permissions.aliasWrite',
    'Create, edit and delete derived entities',
  ),
  'dashboard:manage': defineMessage(
    'permissions.dashboardManage',
    'Create, edit, assign and delete dashboards',
  ),
  'history:read': defineMessage('permissions.historyRead', 'Read state history and telemetry'),
  'package:read': defineMessage(
    'permissions.packageRead',
    'See installed packages and the package store',
  ),
  'package:install': defineMessage(
    'permissions.packageInstall',
    'Install, update and remove packages',
  ),
  'package:configure': defineMessage(
    'permissions.packageConfigure',
    'Change a package configuration and start or stop it',
  ),
  'integration:read': defineMessage(
    'permissions.integrationRead',
    'See configured integrations and the bundles available',
  ),
  'integration:configure': defineMessage(
    'permissions.integrationConfigure',
    'Add integrations, change their configuration and start or stop them',
  ),
  'integration:install': defineMessage(
    'permissions.integrationInstall',
    'Install, update and remove integrations',
  ),
  'user:read': defineMessage('permissions.userRead', 'See the list of users'),
  'user:manage': defineMessage('permissions.userManage', 'Create, edit, disable and delete users'),
  'role:manage': defineMessage('permissions.roleManage', 'Create roles and change what they grant'),
  'logs:read': defineMessage('permissions.logsRead', 'Read logs and use the live tail'),
  'settings:read': defineMessage('permissions.settingsRead', 'See system settings'),
  'settings:write': defineMessage(
    'permissions.settingsWrite',
    'Change system settings, including history retention',
  ),
  'audit:read': defineMessage('permissions.auditRead', 'Read the audit log'),
  'system:read': defineMessage(
    'permissions.systemRead',
    'See the system monitor: processor, memory, disk and network',
  ),
  'container:read': defineMessage(
    'permissions.containerRead',
    'See the containers the machine runs, their settings and their logs',
  ),
  'container:control': defineMessage(
    'permissions.containerControl',
    'Start, stop, restart and update the containers the machine runs',
  ),
  'container:install': defineMessage(
    'permissions.containerInstall',
    'Install and remove containers and compose projects',
  ),
  'backup:restore': defineMessage(
    'permissions.backupRestore',
    'Restore the installation from a backup and download the backup key',
  ),
};

/**
 * What a permission lets somebody do.
 *
 * @param key - The permission: `entity:control`.
 * @returns The sentence.
 */
export function permissionDescription(key: string): string {
  const known = DESCRIPTIONS[key];

  return known === undefined
    ? (PERMISSIONS.find((permission) => permission.key === key)?.description ?? key)
    : text(known);
}
