/**
 * Applying a scene, as a procedure over its members: what to send each one, in what order, and
 * what to put back when some fail and the scene asks for a rollback.
 *
 * ARCHITECTURE.md §6.2: snapshot the members, command them with a bounded concurrency honouring
 * each one's fade, report exactly which did not reach their target, and roll back the ones that
 * did when the scene says so - for lighting a half-applied scene is usually better than a
 * rollback; for a security scene it is not.
 *
 * Pure: the commands go out through a port, and the state before the apply is handed in, so the
 * whole procedure is tested without a broker, a database or a clock.
 */
import {
  commandsForTargetState,
  restoreStateFor,
  type ApplySceneReply,
  type CapabilityName,
  type CapabilityState,
  type EntityId,
  type JsonObject,
  type SceneSentCommand,
  type SceneSkip,
} from '@nebulahome/contracts';

/** How many members are commanded at once. */
export const SCENE_APPLY_CONCURRENCY = 4;

/** One member, with what it was before the apply. */
export type SceneApplyMember = {
  readonly entityId: EntityId;
  readonly targetState: CapabilityState;

  /** Its own fade, or null to use the scene's. */
  readonly transitionMs: number | null;

  /** Its state before the apply, for a rollback. Undefined when it never reported. */
  readonly before: CapabilityState | undefined;
};

/** The scene, as the procedure needs it. */
export type SceneApplyPlan = {
  readonly sceneId: string;
  readonly transitionMs: number;
  readonly rollbackOnPartialFailure: boolean;
  readonly members: readonly SceneApplyMember[];
};

/** What the procedure reaches the world through. */
export type SceneApplyPorts = {
  /**
   * Sends one command and resolves once it is accepted.
   *
   * @throws {Error} When it is refused or nobody answers.
   */
  readonly send: (
    entityId: EntityId,
    capability: CapabilityName,
    command: JsonObject,
  ) => Promise<void>;

  /** Whether the apply has run out of time or been abandoned; checked before each command. */
  readonly isOver: () => boolean;
};

/** How one member fared, filled in as the apply goes. */
type MemberOutcome = {
  readonly entityId: EntityId;
  ok: boolean;
  error: string | null;
  readonly sent: SceneSentCommand[];
};

/**
 * Applies a scene.
 *
 * @param plan - The scene and its members, with their states before.
 * @param skip - Members to leave alone, and why: the caller may not command them.
 * @param ports - How commands go out, and whether time is up.
 * @returns Per-member outcomes, with what was sent to each.
 */
export async function applyScenePlan(
  plan: SceneApplyPlan,
  skip: readonly SceneSkip[],
  ports: SceneApplyPorts,
): Promise<ApplySceneReply> {
  const skipped = new Map(skip.map((entry) => [entry.entityId, entry.reason]));
  const outcomes: MemberOutcome[] = plan.members.map((member) => ({
    entityId: member.entityId,
    ok: false,
    error: null,
    sent: [],
  }));

  /**
   * Sends one member its commands, in order.
   *
   * @param outcome - Where to record what was sent.
   * @param commands - What to send.
   */
  const send = async (
    outcome: MemberOutcome,
    commands: readonly { capability: CapabilityName; command: JsonObject }[],
  ): Promise<void> => {
    for (const entry of commands) {
      if (ports.isOver()) {
        throw new Error('The scene ran out of time');
      }

      // Sequential per entity on purpose: a colour after a level, not both at once.
      // eslint-disable-next-line no-await-in-loop -- see above
      await ports.send(outcome.entityId, entry.capability, entry.command);
      outcome.sent.push({ capability: entry.capability, command: entry.command });
    }
  };

  await forEachConcurrently(plan.members, SCENE_APPLY_CONCURRENCY, async (member, index) => {
    const outcome = outcomes[index];

    if (outcome === undefined) {
      return;
    }

    const reason = skipped.get(member.entityId);

    if (reason !== undefined) {
      outcome.error = reason;

      return;
    }

    const commands = commandsForTargetState(
      member.targetState,
      member.transitionMs ?? plan.transitionMs,
    );

    if (commands.length === 0) {
      outcome.error = 'Nothing in its target state can be commanded';

      return;
    }

    try {
      await send(outcome, commands);
      outcome.ok = true;
    } catch (error: unknown) {
      outcome.error = shortError(error);
    }
  });

  if (plan.rollbackOnPartialFailure && outcomes.some((outcome) => !outcome.ok)) {
    await forEachConcurrently(plan.members, SCENE_APPLY_CONCURRENCY, async (member, index) => {
      const outcome = outcomes[index];

      if (outcome?.ok !== true) {
        return;
      }

      const restore =
        member.before === undefined ? {} : restoreStateFor(member.before, member.targetState);
      const commands = commandsForTargetState(restore, member.transitionMs ?? plan.transitionMs);

      outcome.ok = false;

      if (commands.length === 0) {
        outcome.error = 'Could not roll back: no earlier state to return to';

        return;
      }

      try {
        await send(outcome, commands);
        outcome.error = 'Rolled back after partial failure';
      } catch (error: unknown) {
        outcome.error = `Rollback failed: ${shortError(error)}`;
      }
    });
  }

  const applied = outcomes.filter((outcome) => outcome.ok).length;

  return {
    sceneId: plan.sceneId,
    applied,
    failed: outcomes.length - applied,
    members: outcomes.map((outcome) => ({
      entityId: outcome.entityId,
      ok: outcome.ok,
      error: outcome.error,
      sent: outcome.sent,
    })),
  };
}

/**
 * A short sentence for a failed command, fit for a result field rather than a log line.
 *
 * @param error - What was thrown.
 * @returns The message.
 */
function shortError(error: unknown): string {
  return error instanceof Error && error.message.length > 0 ? error.message : 'Command failed';
}

/**
 * Runs a job over every item, a few at a time.
 *
 * @param items - What to work through.
 * @param concurrency - How many at once.
 * @param job - What to do with each, given its index.
 */
async function forEachConcurrently<T>(
  items: readonly T[],
  concurrency: number,
  job: (item: T, index: number) => Promise<void>,
): Promise<void> {
  let next = 0;

  /** Takes items until there are none left. */
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const index = next;
      const item = items[index];

      next += 1;

      if (item !== undefined) {
        // One after another on purpose: this worker is one lane of a few.
        // eslint-disable-next-line no-await-in-loop -- see above
        await job(item, index);
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
}
