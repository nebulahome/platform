/**
 * Sending an entity its commands, one capability at a time.
 *
 * A control sends as soon as the person acts - a switch on press, a slider when it is let go -
 * and the reply is only the adapter's acknowledgement: the device reaching the state arrives
 * later, over the live channel. So there is nothing to wait for before the next press, except
 * the press before it on the same capability. Two brightness commands in flight at once may
 * arrive in either order and leave the lamp at the first; so a second command waits for the
 * first, and a third replaces the second rather than queueing behind it - only the latest thing
 * the person asked for is worth sending.
 *
 * When the live channel is down, the entity is read again a moment after the acknowledgement,
 * so a page with no socket still catches up with what it just did. A refusal is said in a toast,
 * and kept as `problem` so a control can stop showing what it was not given.
 */
import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';

import type { CapabilityName, JsonObject } from '@nebulahome/contracts';
import { toast } from '@nebulahome/ui';

import { translate } from '@/i18n/messages';
import { toMessage } from '@/lib/error-message';
import { commandEntity, LIBRARY_QUERY_KEYS } from '@/library/api';
import { useLive } from '@/live/live-store';

/** How long after an acknowledgement a page without a socket reads the entity again. */
const REREAD_MS = 2000;

/** What a control gets. */
export type EntityCommander = {
  /**
   * Sends a command.
   *
   * @param capability - Which capability it is for.
   * @param command - The command, e.g. `{ command: 'set_level', level: 40 }`.
   */
  readonly send: (capability: CapabilityName, command: JsonObject) => void;

  /** The capabilities with a command on its way. */
  readonly busy: ReadonlySet<CapabilityName>;

  /** Why the last command was refused, or null. */
  readonly problem: string | null;
};

/**
 * Sends an entity's commands.
 *
 * @param entityId - The entity, by its address.
 * @returns See {@link EntityCommander}.
 */
export function useEntityCommand(entityId: string): EntityCommander {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState<ReadonlySet<CapabilityName>>(new Set());
  const [problem, setProblem] = useState<string | null>(null);

  // Held outside render state: they coordinate requests, and nothing on screen reads them.
  const inFlight = useRef(new Set<CapabilityName>());
  const queued = useRef(new Map<CapabilityName, JsonObject>());

  /**
   * Marks a capability as waiting, or as done.
   *
   * @param capability - Which one.
   * @param isBusy - Whether a command for it is on its way.
   */
  const mark = (capability: CapabilityName, isBusy: boolean): void => {
    setBusy((current) => {
      const next = new Set(current);

      if (isBusy) {
        next.add(capability);
      } else {
        next.delete(capability);
      }

      return next;
    });
  };

  /**
   * Sends one command, then whatever was asked for meanwhile.
   *
   * @param capability - Which capability.
   * @param command - What to send.
   */
  const dispatch = (capability: CapabilityName, command: JsonObject): void => {
    inFlight.current.add(capability);
    mark(capability, true);

    commandEntity(entityId, capability, command)
      .then(() => {
        if (useLive.getState().status !== 'live') {
          setTimeout(() => {
            void queryClient.invalidateQueries({
              queryKey: LIBRARY_QUERY_KEYS.entities,
            });
          }, REREAD_MS);
        }
      })
      .catch((error: unknown) => {
        setProblem(toMessage(error));
        toast.error({
          title: translate('entity.command.failed', 'The command didn’t go through'),
          message: toMessage(error),
        });
      })
      .finally(() => {
        inFlight.current.delete(capability);

        const next = queued.current.get(capability);

        if (next === undefined) {
          mark(capability, false);

          return;
        }

        queued.current.delete(capability);
        dispatch(capability, next);
      });
  };

  return {
    /**
     * Sends a command, or queues it behind the one in flight for the same capability.
     *
     * @param capability - Which capability.
     * @param command - What to send.
     */
    send: (capability, command) => {
      setProblem(null);

      if (inFlight.current.has(capability)) {
        queued.current.set(capability, command);

        return;
      }

      dispatch(capability, command);
    },
    busy,
    problem,
  };
}
