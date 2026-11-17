/**
 * Automations in the command palette: On or Off on the right, a mark when an entity it uses is
 * missing; Enter opens the editor, Tab turns it on or off.
 */
import type { AutomationView } from '@nebulahome/contracts';

import { defineMessage, text, translate } from '@/i18n/messages';
import type { PaletteItem } from '@/palette/palette-types';
import { goTo, HINTS, makeItem } from '@/palette/sources/make-item';

const KIND = defineMessage('palette.kinds.automation', 'Automation');

/**
 * The automations' rows.
 *
 * @param automations - The automations.
 * @param canWrite - Whether the person may turn one on or off.
 * @returns The rows.
 */
export function automationItems(
  automations: readonly AutomationView[],
  canWrite: boolean,
): PaletteItem[] {
  return automations.map((automation) => {
    const isMissing = automation.missingEntities.length > 0;
    const missing = translate('palette.missingEntity', 'An entity it uses is missing');

    return makeItem({
      group: 'automations',
      refId: automation.id,
      title: automation.name,
      secondary: isMissing ? missing : automation.description,
      kindLabel: text(KIND),
      fields: [automation.description],
      exactIds: [automation.id],
      icon: { kind: 'ui', id: 'zap' },
      isName: true,
      state: automation.isEnabled
        ? { text: translate('palette.on', 'On'), isQuiet: false }
        : { text: translate('palette.off', 'Off'), isQuiet: true },
      ...(isMissing ? { warning: missing } : {}),
      isDimmed: !automation.isEnabled,
      primary: goTo(`/automations/${automation.id}`),
      ...(canWrite
        ? {
            secondaryAction: {
              hint: text(automation.isEnabled ? HINTS.disable : HINTS.enable),
              command: {
                type: 'set-automation',
                automationId: automation.id,
                name: automation.name,
                isEnabled: !automation.isEnabled,
              },
            },
          }
        : {}),
    });
  });
}
