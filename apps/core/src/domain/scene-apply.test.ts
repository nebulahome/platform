import { describe, expect, it } from 'vitest';

import { parseEntityId, type CapabilityName, type JsonObject } from '@nebulahome/contracts';

import { applyScenePlan, type SceneApplyMember } from './scene-apply.js';

const ceiling = parseEntityId('light.living_room');
const lamp = parseEntityId('light.reading_lamp');
const door = parseEntityId('lock.front_door');

/** One command as the port saw it. */
type Sent = { entityId: string; capability: CapabilityName; command: JsonObject };

/**
 * A port that accepts everything except the entities named.
 *
 * @param failing - Entities whose commands are refused.
 * @returns The port and what reached it.
 */
function port(failing: readonly string[] = []): {
  send: (entityId: string, capability: CapabilityName, command: JsonObject) => Promise<void>;
  isOver: () => boolean;
  sent: Sent[];
} {
  const sent: Sent[] = [];

  return {
    sent,
    send: (entityId, capability, command) => {
      if (failing.includes(entityId)) {
        return Promise.reject(new Error(`${entityId} did not answer`));
      }

      sent.push({ entityId, capability, command });

      return Promise.resolve();
    },
    isOver: () => false,
  };
}

/**
 * A scene around some members.
 *
 * @param members - The members.
 * @param rollbackOnPartialFailure - Whether to roll back.
 * @returns The plan.
 */
function plan(members: SceneApplyMember[], rollbackOnPartialFailure = false) {
  return {
    sceneId: '00000000-0000-4000-8000-000000000001',
    transitionMs: 2_000,
    rollbackOnPartialFailure,
    members,
  };
}

const evening: SceneApplyMember[] = [
  {
    entityId: ceiling,
    targetState: { on_off: { isOn: true }, level: { level: 40 } },
    transitionMs: null,
    before: { on_off: { isOn: false }, level: { level: 100 } },
  },
  {
    entityId: lamp,
    targetState: { on_off: { isOn: false } },
    transitionMs: 0,
    before: { on_off: { isOn: true } },
  },
];

describe('applyScenePlan', () => {
  it("sends each member its commands in order, with the scene's fade unless it has its own", async () => {
    const ports = port();
    const reply = await applyScenePlan(plan(evening), [], ports);

    expect(reply).toMatchObject({ applied: 2, failed: 0 });
    expect(ports.sent).toEqual([
      { entityId: ceiling, capability: 'on_off', command: { command: 'turn_on' } },
      { entityId: lamp, capability: 'on_off', command: { command: 'turn_off' } },
      {
        entityId: ceiling,
        capability: 'level',
        command: { command: 'set_level', level: 40, transitionMs: 2_000 },
      },
    ]);
    expect(reply.members[0]?.sent).toHaveLength(2);
  });

  it('leaves a skipped member alone and says why', async () => {
    const ports = port();
    const reply = await applyScenePlan(
      plan(evening),
      [{ entityId: lamp, reason: 'You may not control this entity' }],
      ports,
    );

    expect(reply.members[1]).toMatchObject({
      ok: false,
      error: 'You may not control this entity',
      sent: [],
    });
    expect(ports.sent.every((entry) => entry.entityId === ceiling)).toBe(true);
  });

  it('reports the member that failed and keeps the others when no rollback is asked', async () => {
    const reply = await applyScenePlan(plan(evening), [], port([lamp]));

    expect(reply).toMatchObject({ applied: 1, failed: 1 });
    expect(reply.members[1]?.error).toBe('light.reading_lamp did not answer');
  });

  it('rolls back the members that succeeded when the scene asks', async () => {
    const ports = port([lamp]);
    const reply = await applyScenePlan(plan(evening, true), [], ports);

    expect(reply).toMatchObject({ applied: 0, failed: 2 });
    expect(reply.members[0]?.error).toBe('Rolled back after partial failure');
    // Back to off: the ceiling was off before, so only the switch is sent.
    expect(ports.sent.at(-1)).toEqual({
      entityId: ceiling,
      capability: 'on_off',
      command: { command: 'turn_off' },
    });
  });

  it('cannot roll back a member that never reported', async () => {
    const reply = await applyScenePlan(
      plan(
        [
          { ...evening[0]!, before: undefined },
          {
            entityId: door,
            targetState: { lock: { lockState: 'locked' } },
            transitionMs: null,
            before: undefined,
          },
        ],
        true,
      ),
      [],
      port([door]),
    );

    expect(reply.members[0]?.error).toBe('Could not roll back: no earlier state to return to');
  });

  it('says so of a member whose target holds nothing to command', async () => {
    const reply = await applyScenePlan(
      plan([{ entityId: lamp, targetState: {}, transitionMs: null, before: undefined }]),
      [],
      port(),
    );

    expect(reply.members[0]?.error).toBe('Nothing in its target state can be commanded');
  });

  it('stops sending once time is up', async () => {
    const ports = { ...port(), isOver: () => true };
    const reply = await applyScenePlan(plan(evening), [], ports);

    expect(reply.applied).toBe(0);
    expect(reply.members[0]?.error).toBe('The scene ran out of time');
  });
});
