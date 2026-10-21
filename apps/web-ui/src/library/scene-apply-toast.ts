/**
 * How applying a scene went, said in a toast - wherever it was applied from: the list, the scene's
 * page, a dashboard card. Every member is a success; some that did not take is a warning naming
 * them when their names are known; nothing sent is an error.
 */
import type { SceneApplyResult } from '@nebulahome/contracts';
import { toast } from '@nebulahome/ui';

import { translate } from '@/i18n/messages';
import { toMessage } from '@/lib/error-message';

/**
 * Says how applying went.
 *
 * @param result - What the server reported.
 * @param name - The scene's name.
 * @param entityName - Names a member's entity, when the caller has them.
 */
export function toastSceneApplied(
  result: SceneApplyResult,
  name: string,
  entityName?: (entityId: SceneApplyResult['members'][number]['entityId']) => string,
): void {
  if (result.failed === 0) {
    toast.success({ title: translate('library.sceneApply.applied', '{{name}} applied', { name }) });

    return;
  }

  const failed =
    entityName === undefined
      ? []
      : result.members
          .filter((member) => !member.ok)
          .map((member) => {
            const detail =
              member.error === null || member.error === ''
                ? translate('library.sceneApply.failedMember', 'failed')
                : member.error;

            return `${entityName(member.entityId)}: ${detail}`;
          });

  toast.warning({
    title: translate('library.sceneApply.partly', {
      name,
      count: result.failed,
      defaultValue_one: '{{name}} applied, but {{count}} did not take',
      defaultValue_other: '{{name}} applied, but {{count}} did not take',
    }),
    ...(failed.length === 0 ? {} : { message: failed.join(' · ') }),
  });
}

/**
 * Says why nothing was applied.
 *
 * @param error - What went wrong.
 * @param name - The scene's name.
 */
export function toastSceneFailed(error: unknown, name: string): void {
  toast.error({
    title: translate('library.sceneApply.failed', 'Couldn’t apply {{name}}', { name }),
    message: toMessage(error),
  });
}
