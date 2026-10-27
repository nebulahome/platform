/**
 * A remote as a device: its buttons as button entities, a press as the button the broker sends,
 * and the buttons unavailable while the blaster cannot send.
 */
import { describe, expect, it } from 'vitest';

import { formatEntityId } from '@nebulahome/contracts';

import { createInfraredIntegration, type InfraredRemoteSnapshot } from './infrared-mapping.js';
import type { MappingContext } from './integration.js';

const POWER = '0b6f2f4e-8a1d-4c55-9a3e-2f1c7d9e0a11';
const MUTE = '6d1e2c3b-4a59-4687-b7a6-958473625140';

const remote: InfraredRemoteSnapshot = {
  deviceKey: 'infrared-5f2b1c9e-0d7a-4e3b-8c6f-1a2b3c4d5e6f',
  kind: 'infrared/remote',
  name: 'Living room TV',
  buttons: [
    { id: POWER, name: 'Power', icon: 'power' },
    { id: MUTE, name: 'Mute', icon: null },
  ],
};

const integration = createInfraredIntegration({ id: 'infrared/remote' });

/**
 * The context the hub hands a mapper of the remote.
 *
 * @returns The context, each button given an entity.
 */
function contextOf(): MappingContext {
  return {
    options: {},
    claim: { deviceKey: remote.deviceKey, externalId: remote.deviceKey, descriptor: remote },
    entities: new Map([
      [POWER, formatEntityId('button', 'tv_power')],
      [MUTE, formatEntityId('button', 'tv_mute')],
    ]),
    lastState: () => undefined,
  };
}

describe('createInfraredIntegration', () => {
  it('claims the remotes of its own kind only', () => {
    expect(integration.claim({ deviceKey: remote.deviceKey, payload: remote }, {})).toEqual({
      deviceKey: remote.deviceKey,
      externalId: remote.deviceKey,
      descriptor: remote,
    });
    expect(
      integration.claim({ deviceKey: 'x', payload: { ...remote, kind: 'other/remote' } }, {}),
    ).toBeNull();
    expect(integration.claim({ deviceKey: 'x', payload: { name: 'TV' } }, {})).toBeNull();
  });

  it('describes a button entity per button, by its id, with its name and icon', () => {
    const claim = integration.claim({ deviceKey: remote.deviceKey, payload: remote }, {});

    expect(claim === null ? null : integration.describe(claim, {})).toEqual({
      externalId: remote.deviceKey,
      name: 'Living room TV',
      entities: [
        {
          domain: 'button',
          objectId: POWER,
          name: 'Power',
          icon: 'power',
          capabilities: { button: {} },
        },
        { domain: 'button', objectId: MUTE, name: 'Mute', capabilities: { button: {} } },
      ],
    });
  });

  it('turns a press into the button the broker sends', () => {
    expect(
      integration.toCommand(
        {
          entityId: formatEntityId('button', 'tv_mute'),
          capability: 'button',
          command: { command: 'press' },
        },
        contextOf(),
      ),
    ).toEqual({ deviceKey: remote.deviceKey, op: 'press', args: { buttonId: MUTE } });
    expect(() =>
      integration.toCommand(
        {
          entityId: formatEntityId('button', 'other'),
          capability: 'button',
          command: { command: 'press' },
        },
        contextOf(),
      ),
    ).toThrow('has no button');
  });

  it('makes every button unavailable while the blaster cannot send', () => {
    const reports = integration.toState(
      { connectionKey: 'infrared', deviceKey: remote.deviceKey, payload: { isAvailable: false } },
      contextOf(),
    );

    expect(reports).toEqual([
      { entityId: 'button.tv_power', state: { button: {} }, attributes: {}, isAvailable: false },
      { entityId: 'button.tv_mute', state: { button: {} }, attributes: {}, isAvailable: false },
    ]);
    expect(
      integration.toState(
        { connectionKey: 'infrared', deviceKey: remote.deviceKey, payload: 'garbage' },
        contextOf(),
      ),
    ).toEqual([]);
  });
});
