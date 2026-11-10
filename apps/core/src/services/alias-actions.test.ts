import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  aliasPartsSchema,
  aliasType,
  aliasTypeParts,
  type AliasPartDef,
  type JsonObject,
} from '@nebulahome/contracts';
import type { Database } from '@nebulahome/db';
import type { PlatformLogger } from '@nebulahome/logging';

import type { AliasDefinition } from '../domain/alias-catalog.js';

import { AliasActions } from './alias-actions.js';
import type { ActionsRunOutcome, ActionsRunRequest } from './automation-engine.js';

const LIGHT = aliasType('light');
const DEFS = aliasTypeParts(LIGHT);
const def = (key: string): AliasPartDef => DEFS.find((candidate) => candidate.key === key)!;
const sceneStep = { type: 'scene', sceneKey: 'evening' };

/**
 * A light alias whose parts have the given actions.
 *
 * @param parts - The parts, as stored.
 * @returns The definition the engine keeps.
 */
function lightAlias(parts: unknown): AliasDefinition {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    entityId: 'alias.downstairs',
    type: LIGHT,
    defs: DEFS,
    parts: aliasPartsSchema.parse(parts),
    isEnabled: true,
  } as unknown as AliasDefinition;
}

/**
 * A runner whose runs are recorded and end when told.
 *
 * @returns The runner, its runs and the rows it wrote.
 */
function harness() {
  const requests: ActionsRunRequest[] = [];
  const rows: unknown[] = [];
  const db = {
    insert: () => ({
      values: (row: unknown) => {
        rows.push(row);

        return Promise.resolve();
      },
    }),
  } as unknown as Database;
  const logger = { warn: vi.fn() } as unknown as PlatformLogger;
  const actions = new AliasActions({
    db,
    logger,
    run: (request): Promise<ActionsRunOutcome> => {
      requests.push(request);
      const now = new Date();

      return Promise.resolve({
        result: 'success',
        error: null,
        steps: [],
        startedAt: now,
        finishedAt: now,
      });
    },
    bind: () => null,
    publish: vi.fn(),
  });

  return { actions, requests, rows };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('the actions of an alias', () => {
  it('starts the action a command names, and none for the alias commanding itself', () => {
    const { actions, requests } = harness();
    const alias = lightAlias({
      on: {
        from: 'entities',
        entities: ['light.hall'],
        rule: 'any',
        actions: [{ id: 'on', when: { kind: 'command', command: 'turn_on' }, then: [sceneStep] }],
      },
    });
    const command: JsonObject = { command: 'turn_on' };
    const found = actions.forCommand(alias, [def('on')], command, { type: 'user' });

    expect([...found.keys()]).toEqual(['on']);
    expect(actions.forCommand(alias, [def('on')], { command: 'turn_off' }, undefined).size).toBe(0);
    expect(
      actions.forCommand(alias, [def('on')], command, { type: 'alias', id: alias.id }).size,
    ).toBe(0);

    actions.startForCommand(alias, found, command, { type: 'user' });

    expect(requests).toHaveLength(1);
    expect(requests[0]?.context).toEqual({ type: 'alias', id: alias.id });
    expect(requests[0]?.startedBy).toEqual({ kind: 'alias', aliasId: alias.id, part: 'on' });
  });

  it('stops the run still going when the same action starts again', () => {
    const { actions, requests } = harness();
    const alias = lightAlias({
      on: {
        from: 'stored',
        actions: [{ id: 'on', when: { kind: 'command', command: 'turn_on' }, then: [sceneStep] }],
      },
    });
    const found = actions.forCommand(alias, [def('on')], { command: 'turn_on' }, undefined);

    actions.startForCommand(alias, found, { command: 'turn_on' }, undefined);
    actions.startForCommand(alias, found, { command: 'turn_on' }, undefined);

    expect(requests).toHaveLength(2);
    expect(requests[0]?.signal.aborted).toBe(true);
    expect(requests[1]?.signal.aborted).toBe(false);
  });

  it('starts a change after its value held for the time, and drops it when it left', () => {
    vi.useFakeTimers();

    const { actions, requests } = harness();
    const alias = lightAlias({
      on: { from: 'stored' },
      brightness: {
        from: 'stored',
        actions: [
          {
            id: 'bright',
            when: {
              kind: 'change',
              change: { kind: 'numeric', operator: 'gt', value: 60 },
              forMs: 5_000,
            },
            then: [sceneStep],
          },
        ],
      },
    });
    const values = (level: number) => new Map([['brightness', level]]);

    actions.onValues(alias, () => 40, values(72), undefined);
    actions.onValues(alias, () => 72, values(30), undefined);
    vi.advanceTimersByTime(6_000);
    expect(requests).toHaveLength(0);

    actions.onValues(alias, () => 30, values(80), undefined);
    vi.advanceTimersByTime(6_000);
    expect(requests).toHaveLength(1);
  });

  it('refuses an action that starts more than thirty times a minute, and records it', async () => {
    const { actions, requests, rows } = harness();
    const alias = lightAlias({
      on: {
        from: 'stored',
        actions: [{ id: 'on', when: { kind: 'command', command: 'toggle' }, then: [sceneStep] }],
      },
    });
    const found = actions.forCommand(alias, [def('on')], { command: 'toggle' }, undefined);

    for (let index = 0; index < 31; index += 1) {
      actions.startForCommand(alias, found, { command: 'toggle' }, undefined);
    }

    await vi.waitFor(() => {
      expect(rows).toHaveLength(31);
    });
    expect(requests).toHaveLength(30);
    expect(rows).toContainEqual(expect.objectContaining({ result: 'cancelled', actionId: 'on' }));
  });
});
