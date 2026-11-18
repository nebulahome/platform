/**
 * How a together card sends a command to its members and says what became of it.
 *
 * One command per member, through the platform's command path, each to a member that can take it:
 * a brightness only to the lamps that dim, a lock only to the locks a card may lock. The card says
 * "Sending" until every member has answered - reported again - and when some did not within the
 * kit's time, how many ("2 did not answer"), with Try again for those only. A refused request is
 * no answer at once, and said in a toast as any command's refusal is.
 *
 * It is a {@link CardCommand} too, so the kit's caption ("Turning on…") reads it as it reads any
 * card's.
 */
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import type { CapabilityName, EntityView, JsonObject } from '@nebulahome/contracts';
import { toast } from '@nebulahome/ui';

import { translate } from '@/i18n/messages';
import { toMessage } from '@/lib/error-message';
import { commandEntity, LIBRARY_QUERY_KEYS } from '@/library/api';
import { hasCapability } from '@/library/entity-control';
import { useLive } from '@/live/live-store';
import type { TogetherMember } from '@/routes/dashboard/cards/together-members';
import {
  COMMAND_ANSWER_MS,
  NO_ANSWER_SHOWN_MS,
  type CardCommand,
} from '@/routes/dashboard/cards/use-card-command';

/** How long after the acknowledgements a page without a socket reads the entities again. */
const REREAD_MS = 2000;

/** An entity's address. */
type EntityId = EntityView['entityId'];

/** What a together card's commands are doing. */
export type TogetherCommand = Omit<CardCommand, 'send'> & {
  /**
   * Sends one command to every member that can take it: it has the capability, it can be reached
   * and this person may command it.
   *
   * @param capability - The capability commanded.
   * @param command - The command.
   * @param only - Narrows the members further: the lamps that dim, the locks left open.
   */
  readonly send: (
    capability: CapabilityName,
    command: JsonObject,
    only?: (member: TogetherMember) => boolean,
  ) => void;

  /** Sends each member its own command: a target moved by the same step from its own. */
  readonly sendEach: (
    capability: CapabilityName,
    orders: ReadonlyMap<EntityId, JsonObject>,
  ) => void;

  /** How many members did not answer the last command; 0 while it is out or once all answered. */
  readonly unanswered: number;
};

/** A command sent to some members, and what each had last said when it went. */
type Out = {
  readonly id: number;
  readonly capability: CapabilityName;
  readonly orders: ReadonlyMap<EntityId, JsonObject>;
  readonly sentAt: ReadonlyMap<EntityId, number | null>;
  readonly refused: ReadonlySet<EntityId>;
};

/**
 * A together card's command path.
 *
 * @param members - The members, with when each last reported: a new report is its answer.
 * @returns See {@link TogetherCommand}.
 */
export function useTogetherCommand(members: readonly TogetherMember[]): TogetherCommand {
  const queryClient = useQueryClient();
  const [out, setOut] = useState<Out | null>(null);
  // The commands whose time ran out, and the ones whose message has left, by id.
  const [lateId, setLateId] = useState<number | null>(null);
  const [goneId, setGoneId] = useState<number | null>(null);

  const reportedAt = new Map<string, number | null>(
    members.map((member) => [member.entity.entityId, member.reportedAt]),
  );
  const sentTo = out === null ? [] : [...out.orders.keys()];
  const unanswered = sentTo.filter(
    (entityId) => reportedAt.get(entityId) === out?.sentAt.get(entityId),
  );
  const isLate = out !== null && lateId === out.id;
  const isWaiting = !isLate && unanswered.some((entityId) => out?.refused.has(entityId) !== true);
  const failed = out === null || isWaiting || goneId === out.id ? [] : unanswered;

  // No report in time from some: the card says how many.
  useEffect(() => {
    if (out === null || !isWaiting) {
      return undefined;
    }

    const timer = setTimeout(() => {
      setLateId(out.id);
    }, COMMAND_ANSWER_MS);

    return (): void => {
      clearTimeout(timer);
    };
  }, [out, isWaiting]);

  // The message leaves by itself.
  const hasFailed = failed.length > 0;

  useEffect(() => {
    if (out === null || !hasFailed) {
      return undefined;
    }

    const timer = setTimeout(() => {
      setGoneId(out.id);
    }, NO_ANSWER_SHOWN_MS);

    return (): void => {
      clearTimeout(timer);
    };
  }, [out, hasFailed]);

  /**
   * Sends the members their commands and starts waiting for their answers.
   *
   * @param capability - The capability commanded.
   * @param orders - Each member's command, by its address.
   */
  const dispatch = (
    capability: CapabilityName,
    orders: ReadonlyMap<EntityId, JsonObject>,
  ): void => {
    if (orders.size === 0) {
      return;
    }

    const id = (out?.id ?? 0) + 1;

    setOut({
      id,
      capability,
      orders,
      sentAt: new Map(
        [...orders.keys()].map((entityId) => [entityId, reportedAt.get(entityId) ?? null]),
      ),
      refused: new Set<EntityId>(),
    });

    const requests = [...orders].map(async ([entityId, command]) =>
      commandEntity(entityId, capability, command).catch((error: unknown) => {
        setOut((current) =>
          current?.id === id
            ? { ...current, refused: new Set([...current.refused, entityId]) }
            : current,
        );

        throw error;
      }),
    );

    void Promise.allSettled(requests).then((results) => {
      const refusal = results.find((result) => result.status === 'rejected');

      if (refusal !== undefined) {
        toast.error({
          title: translate('entity.command.failed', 'The command didn’t go through'),
          message: toMessage(refusal.reason),
        });
      }

      // A page with no socket reads the entities again, so the card catches up with what it did.
      if (useLive.getState().status !== 'live') {
        setTimeout(() => {
          void queryClient.invalidateQueries({ queryKey: LIBRARY_QUERY_KEYS.entities });
        }, REREAD_MS);
      }
    });
  };

  return {
    /**
     * Sends one command to every member that can take it.
     *
     * @param capability - The capability commanded.
     * @param command - The command.
     * @param only - Narrows the members further.
     */
    send: (capability, command, only) => {
      dispatch(
        capability,
        new Map(
          members
            .filter(
              (member) =>
                member.isAvailable &&
                member.canControl &&
                hasCapability(member.entity, capability) &&
                (only?.(member) ?? true),
            )
            .map((member) => [member.entity.entityId, command]),
        ),
      );
    },
    sendEach: dispatch,
    sending: out !== null && isWaiting ? out.capability : null,
    hasFailed,
    unanswered: failed.length,

    /** Sends the last command again, to the members that did not answer it only. */
    retry: () => {
      if (out !== null) {
        dispatch(
          out.capability,
          new Map(
            failed.flatMap((entityId) => {
              const command = out.orders.get(entityId);

              return command === undefined ? [] : [[entityId, command] as const];
            }),
          ),
        );
      }
    },
  };
}
