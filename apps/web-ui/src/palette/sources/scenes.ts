/**
 * Scenes in the command palette: the one kind where Enter acts. A scene is looked for to be
 * applied, so Enter applies it and Tab opens it; without the permission to apply - or while a
 * member is missing - Enter opens it and there is no Tab.
 */
import type { SceneView } from '@nebulahome/contracts';

import { defineMessage, text, translate } from '@/i18n/messages';
import type { PaletteItem } from '@/palette/palette-types';
import { goTo, HINTS, makeItem } from '@/palette/sources/make-item';

const KIND = defineMessage('palette.kinds.scene', 'Scene');

/**
 * The scenes' rows.
 *
 * @param scenes - The scenes.
 * @param areaNames - The areas' names, by key.
 * @param canApply - Whether the person may apply a scene.
 * @returns The rows.
 */
export function sceneItems(
  scenes: readonly SceneView[],
  areaNames: ReadonlyMap<string, string>,
  canApply: boolean,
): PaletteItem[] {
  return scenes.map((scene) => {
    const area = scene.areaKey === null ? undefined : areaNames.get(scene.areaKey);
    const open = goTo(`/scenes/${scene.id}`);
    const isApplied = canApply && scene.unresolvedMembers.length === 0;

    return makeItem({
      group: 'scenes',
      refId: scene.id,
      title: scene.name,
      secondary: [
        area,
        translate('palette.members', {
          count: scene.members.length,
          defaultValue_one: '{{count}} member',
          defaultValue_other: '{{count}} members',
        }),
      ]
        .filter(Boolean)
        .join(' · '),
      kindLabel: text(KIND),
      exactIds: [scene.id],
      icon: { kind: 'catalogue', iconId: scene.icon, fallback: 'layers' },
      isName: true,
      primary: isApplied
        ? {
            hint: text(HINTS.apply),
            command: { type: 'apply-scene', sceneId: scene.id, name: scene.name },
          }
        : open,
      ...(isApplied ? { secondaryAction: open } : {}),
    });
  });
}
