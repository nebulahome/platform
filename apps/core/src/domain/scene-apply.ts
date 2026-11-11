/**
 * Applying a scene, as a procedure over its members: what to send each one, in what order, and
 * what to put back when some fail and the scene asks for a rollback.
 *
 * ARCHITECTURE.md §6.2: snapshot the members, command them with a bounded concurrency, report
 * exactly which did not reach their target, and roll back the ones that did when the scene says
 * so - for lighting a half-applied scene is usually better than a rollback; for a security scene
 * it is not.
 *
 * Pure but for the rollback's own time limit: the commands go out through a port, and the state
 * before the apply is handed in, so the whole procedure is tested without a broker or a database.
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

/** How long a rollback may take, counted from when it starts. */
export const SCENE_ROLLBACK_MS = 10_000;

/** One member, with what it was before the apply. */
export type SceneApplyMember = {
  readonly entityId: EntityId;
  readonly targetState: CapabilityState;

  /** Its state before the apply, for a rollback. Undefined when it never reported. */
  readonly before: CapabilityState | undefined;
};

/** The scene, as the procedure needs it. */
export type SceneApplyPlan = {
  readonly sceneId: string;
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
   * @param isOver - Whether time is up, checked before each command.
   * @throws {Error} When time is up before a command, or one is refused.
   */
  const send = async (
    outcome: MemberOutcome,
    commands: readonly { capability: CapabilityName; command: JsonObject }[],
    isOver: () => boolean,
  ): Promise<void> => {
    for (const entry of commands) {
      if (isOver()) {
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

    const commands = commandsForTargetState(member.targetState);

    if (commands.length === 0) {
      outcome.error = 'Nothing in its target state can be commanded';

      return;
    }

    try {
      await send(outcome, commands, ports.isOver);
      outcome.ok = true;
    } catch (error: unknown) {
      outcome.error = shortError(error);
    }
  });

  if (plan.rollbackOnPartialFailure && outcomes.some((outcome) => !outcome.ok)) {
    // Its own time: an apply that failed by running out of it must still be put back.
    const rollbackEnds = Date.now() + SCENE_ROLLBACK_MS;
    /**
     * Whether the rollback is out of time.
     *
     * @returns True past its budget.
     */
    const isRollbackOver = (): boolean => Date.now() > rollbackEnds;
    // A member is put back once any command reached it: one whose second command failed has
    // still changed.
    const touched = outcomes.map((outcome) => outcome.sent.length > 0);

    await forEachConcurrently(plan.members, SCENE_APPLY_CONCURRENCY, async (member, index) => {
      const outcome = outcomes[index];

      if (outcome === undefined || touched[index] !== true) {
        return;
      }

      const restore =
        member.before === undefined ? {} : restoreStateFor(member.before, member.targetState);
      const commands = commandsForTargetState(restore);
      const wasOk = outcome.ok;

      outcome.ok = false;

      if (commands.length === 0) {
        // A member that failed keeps saying why.
        outcome.error = wasOk
          ? 'Could not roll back: no earlier state to return to'
          : outcome.error;

        return;
      }

      try {
        await send(outcome, commands, isRollbackOver);
        outcome.error = wasOk ? 'Rolled back after partial failure' : outcome.error;
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
