/**
 * How a card sends a command and says what became of it.
 *
 * Every control of a card goes through one of these, so the card knows a command is out and can
 * say so where its caption is ("Turning on…"), keep its other controls still until the answer, and
 * - when the device does not answer in time - put the control back and offer to try again. The
 * answer is the device reporting again; a refused request is no answer at once.
 */
import { useEffect, useState } from 'react';

import type { CapabilityName, JsonObject } from '@nebulahome/contracts';

import { useEntityCommand } from '@/routes/library/entity/use-entity-command';

/** How long a device has to answer a command before the card says it did not. */
export const COMMAND_ANSWER_MS = 10_000;

/** How long "Did not answer" stays on a card before it leaves by itself. */
export const NO_ANSWER_SHOWN_MS = 60_000;

/** What a card's commands are doing. */
export type CardCommand = {
  /** Sends a command, and waits for the device to report. */
  readonly send: (capability: CapabilityName, command: JsonObject) => void;

  /** The capability a command is out for and not yet answered, or null. */
  readonly sending: CapabilityName | null;

  /** Whether the last command went unanswered. */
  readonly hasFailed: boolean;

  /** Sends the unanswered command again. */
  readonly retry: () => void;
};

/** A command sent, and what the device had last said when it went. */
type Out = {
  readonly id: number;
  readonly capability: CapabilityName;
  readonly command: JsonObject;
  readonly reportedAt: number | null;
};

/**
 * A card's command path.
 *
 * @param entityId - The entity the card commands.
 * @param reportedAt - When it last reported: a new report is its answer.
 * @returns See {@link CardCommand}.
 */
export function useCardCommand(entityId: string, reportedAt: number | null): CardCommand {
  const commander = useEntityCommand(entityId);
  const [out, setOut] = useState<Out | null>(null);
  // The commands whose time ran out, and the ones whose message has left, by id.
  const [lateId, setLateId] = useState<number | null>(null);
  const [goneId, setGoneId] = useState<number | null>(null);

  const isAnswered = out !== null && reportedAt !== out.reportedAt;
  const isRefused = out !== null && commander.problem !== null;
  const isLate = out !== null && lateId === out.id;
  const isWaiting = out !== null && !isAnswered && !isRefused && !isLate;
  const hasFailed = out !== null && !isAnswered && (isRefused || isLate) && goneId !== out.id;

  // No report in time: the control goes back and the card says so.
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
   * Sends a command and starts waiting for its answer.
   *
   * @param capability - The capability commanded.
   * @param command - The command.
   */
  const send = (capability: CapabilityName, command: JsonObject): void => {
    setOut({ id: (out?.id ?? 0) + 1, capability, command, reportedAt });
    commander.send(capability, command);
  };

  return {
    send,
    sending: isWaiting ? out.capability : null,
    hasFailed,

    /** Sends the unanswered command again. */
    retry: () => {
      if (out !== null) {
        send(out.capability, out.command);
      }
    },
  };
}
