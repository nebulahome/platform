/**
 * How a card that sums up sends one command to many entities at once: every light of a room off,
 * every blind of it up.
 *
 * Each entity gets its own command through the platform's command path (`commandEntity`), all at
 * once; the card knows which of its controls is out until every one was taken, and a toast says
 * how many were refused and why. What the devices then do arrives over the live channel; a page
 * without it reads the entities again.
 */
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import type { CapabilityName, JsonObject } from '@nebulahome/contracts';
import { toast } from '@nebulahome/ui';

import { translate } from '@/i18n/messages';
import { toMessage } from '@/lib/error-message';
import { commandEntity, LIBRARY_QUERY_KEYS } from '@/library/api';
import { useLive } from '@/live/live-store';

/** What a card's group commands are doing. */
export type GroupCommand = {
  /**
   * Sends one command to every entity given.
   *
   * @param control - Which control of the card sent it, so that one shows it is out.
   * @param entityIds - The entities.
   * @param capability - The capability commanded.
   * @param command - The command.
   */
  readonly send: (
    control: string,
    entityIds: readonly string[],
    capability: CapabilityName,
    command: JsonObject,
  ) => void;

  /** The control whose commands are out and not yet taken, or null. */
  readonly sending: string | null;
};

/**
 * A card's command path for many entities.
 *
 * @returns See {@link GroupCommand}.
 */
export function useGroupCommand(): GroupCommand {
  const queryClient = useQueryClient();
  const [sending, setSending] = useState<string | null>(null);

  return {
    sending,

    /**
     * Sends one command to every entity given.
     *
     * @param control - Which control sent it.
     * @param entityIds - The entities.
     * @param capability - The capability commanded.
     * @param command - The command.
     */
    send: (control, entityIds, capability, command) => {
      setSending(control);
      // shortcut: "sending" ends when the adapters take the commands, not when the devices report;
      // per-member answers and Try again (as Together does) when a room row needs them.
      void Promise.allSettled(
        entityIds.map(async (entityId) => commandEntity(entityId, capability, command)),
      ).then((results) => {
        setSending(null);

        const refused = results.filter((result) => result.status === 'rejected');

        if (refused[0] !== undefined) {
          toast.error({
            title: translate('dashboard.cards.overview.refused', {
              count: refused.length,
              defaultValue_one: '{{count}} did not take the command',
              defaultValue_other: '{{count}} did not take the command',
            }),
            message: toMessage(refused[0].reason),
          });
        }

        if (useLive.getState().status !== 'live') {
          void queryClient.invalidateQueries({ queryKey: LIBRARY_QUERY_KEYS.entities });
        }
      });
    },
  };
}
