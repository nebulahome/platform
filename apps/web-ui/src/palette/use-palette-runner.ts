/**
 * Carrying out what a row of the command palette does (docs: command palette, 7 and 8). Going
 * somewhere closes the palette first, then navigates; applying a scene closes it a moment later,
 * without waiting for the answer; turning an automation on or off leaves it open. Every outcome is
 * a toast - the same ones the pages say - and a failure is never silent.
 *
 * Turning an entity on or off is not here: it belongs to the active row's own button
 * (`palette-quick-action.tsx`), which holds the one `useEntityCommand` the palette needs.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import { toast } from '@nebulahome/ui';

import { useSession } from '@/auth/session-store';
import { toMessage } from '@/lib/error-message';
import { applyScene, LIBRARY_QUERY_KEYS, updateAutomation } from '@/library/api';
import { toastSceneApplied, toastSceneFailed } from '@/library/scene-apply-toast';
import { usePaletteStore } from '@/palette/palette-store';
import type { PaletteCommand } from '@/palette/palette-types';

/** Applying a scene. */
type SceneApply = Extract<PaletteCommand, { readonly type: 'apply-scene' }>;

/** Turning an automation on or off. */
type AutomationSwitch = Extract<PaletteCommand, { readonly type: 'set-automation' }>;

/** How long the check shows on a scene just applied before the palette closes. */
export const APPLIED_CLOSE_MS = 180;

/**
 * The function that carries out a row's command.
 *
 * @returns It.
 */
export function usePaletteRunner(): (command: PaletteCommand) => void {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const close = usePaletteStore((state) => state.close);
  const signOut = useSession((state) => state.signOut);

  // The callbacks are the mutation's own, so they still run once the palette has closed.
  const apply = useMutation({
    /**
     * Applies the scene.
     *
     * @param command - Which.
     * @returns What the hub did.
     */
    mutationFn: async (command: SceneApply) => applyScene(command.sceneId),
    /**
     * Says it was applied, and what did not take.
     *
     * @param result - What the hub did.
     * @param command - Which scene.
     */
    onSuccess: (result, command) => {
      toastSceneApplied(result, command.name);
    },
    /**
     * Says why it was not applied.
     *
     * @param error - What went wrong.
     * @param command - Which scene.
     */
    onError: (error, command) => {
      toastSceneFailed(error, command.name);
    },
  });

  const toggle = useMutation({
    /**
     * Turns the automation on or off.
     *
     * @param command - Which, and which way.
     */
    mutationFn: async (command: AutomationSwitch) => {
      // The editor reads the automation under its own key; seeded, it opens on the switch as it is.
      queryClient.setQueryData(
        [...LIBRARY_QUERY_KEYS.automations, command.automationId],
        await updateAutomation(command.automationId, { isEnabled: command.isEnabled }),
      );
    },
    /**
     * Says it was turned on or off.
     *
     * @param result - Nothing.
     * @param command - Which, and which way.
     */
    onSuccess: (result, command) => {
      toast.success({
        title: command.isEnabled
          ? t('library.automations.turnedOn', '{{name}} turned on', { name: command.name })
          : t('library.automations.turnedOff', '{{name}} turned off', { name: command.name }),
      });
    },
    /**
     * Says it was not changed, and why.
     *
     * @param error - What went wrong.
     */
    onError: (error) => {
      toast.error({
        title: t('library.automations.notChanged', 'The automation was not changed'),
        message: toMessage(error),
      });
    },
    /** Reads the automations again, whatever happened. */
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: LIBRARY_QUERY_KEYS.automations });
    },
  });

  return (command) => {
    switch (command.type) {
      case 'go':
        close();
        void navigate(command.to);
        break;
      case 'apply-scene':
        apply.mutate(command);
        setTimeout(close, APPLIED_CLOSE_MS);
        break;
      case 'set-automation':
        toggle.mutate(command);
        break;
      case 'sign-out':
        close();
        void signOut();
        break;
      case 'power':
        // Carried out by the active row's own button.
        break;
    }
  };
}
