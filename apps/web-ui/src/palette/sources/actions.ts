/**
 * The command palette's few actions (docs: command palette, 7). A long list becomes noise, so
 * these are all of them; one the person may not do is not offered. Pages and settings ("Theme",
 * "Users") are found as themselves, not as actions.
 */
import type { UiIconId } from '@nebulahome/ui';

import { defineMessage, text, type Message } from '@/i18n/messages';
import type { PaletteCommand, PaletteItem } from '@/palette/palette-types';
import { HINTS, makeItem } from '@/palette/sources/make-item';

/** One action. */
type Action = {
  readonly id: string;
  readonly label: Message;
  readonly line: Message;
  readonly icon: UiIconId;
  readonly command: PaletteCommand;
  readonly permission?: string;
};

/** The actions, the first four of them those the empty field offers. */
const ACTIONS: readonly Action[] = [
  {
    id: 'new-automation',
    label: defineMessage('palette.actions.newAutomation', 'New automation'),
    line: defineMessage('nav.automations', 'Automations'),
    icon: 'zap',
    command: { type: 'go', to: '/automations/new' },
    permission: 'automation:write',
  },
  {
    id: 'new-scene',
    label: defineMessage('palette.actions.newScene', 'New scene'),
    line: defineMessage('nav.scenes', 'Scenes'),
    icon: 'layers',
    command: { type: 'go', to: '/scenes/new' },
    permission: 'scene:write',
  },
  {
    id: 'add-device',
    label: defineMessage('palette.actions.addDevice', 'Add device'),
    line: defineMessage('palette.actions.addDeviceLine', 'Pick its integration first'),
    icon: 'cpu',
    command: { type: 'go', to: '/integrations' },
    permission: 'device:write',
  },
  {
    id: 'add-integration',
    label: defineMessage('palette.actions.addIntegration', 'Add integration'),
    line: defineMessage('palette.actions.addIntegrationLine', 'From the Hub'),
    icon: 'library',
    command: { type: 'go', to: '/integrations?hub=' },
    permission: 'integration:install',
  },
  {
    id: 'sign-out',
    label: defineMessage('palette.actions.signOut', 'Sign out'),
    line: defineMessage('palette.actions.signOutLine', 'On this device'),
    icon: 'user-round',
    command: { type: 'sign-out' },
  },
];

/** How many actions the empty field offers. */
export const ACTIONS_WHEN_EMPTY = 4;

/**
 * The actions the person may run.
 *
 * @param can - Whether the person holds a permission.
 * @returns Their rows, in order.
 */
export function actionItems(can: (key: string) => boolean): PaletteItem[] {
  return ACTIONS.filter((action) => action.permission === undefined || can(action.permission)).map(
    (action) =>
      makeItem({
        group: 'actions',
        refId: action.id,
        title: text(action.label),
        secondary: text(action.line),
        icon: { kind: 'ui', id: action.icon },
        primary: { hint: text(HINTS.run), command: action.command },
      }),
  );
}
