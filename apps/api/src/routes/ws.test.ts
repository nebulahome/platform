/**
 * A package's live channel on the socket: who may follow and send, what a follower hears first,
 * and the budget that stops a socket flooding a package.
 */
import { describe, expect, it } from 'vitest';

import { BusClient } from '@nebulahome/bus';
import { FakeTransport } from '@nebulahome/bus/testing';
import {
  busSubjects,
  packageLiveInboxSchema,
  WS_CLIENT_MESSAGES_PER_SECOND,
  WS_MAX_PACKAGE_TOPICS,
  type Identity,
  type PackageLiveInbox,
  type WsServerMessage,
} from '@nebulahome/contracts';
import { createLogger } from '@nebulahome/logging';

import { EventFanout, liveKey } from '../services/events.js';

import {
  grantsKey,
  handlePackageLive,
  missingTopicPermission,
  narrowReadable,
  serializeMessage,
  sharedReads,
  singleFlight,
  spend,
  type PackageLiveSocket,
} from './ws.js';

const logger = createLogger({ service: 'api', version: '0.0.0', level: 'fatal' });

/**
 * Someone signed in, with some permissions.
 *
 * @param permissions - What they may do.
 * @returns Their identity.
 */
function identityWith(...permissions: string[]): Identity {
  return {
    userId: '00000000-0000-4000-8000-000000000001',
    username: 'ada',
    role: 'member',
    permissions: permissions.map((key) => ({ key, scope: '*', effect: 'allow' })),
    credential: 'session',
  };
}

/**
 * A socket of someone's, and what it was sent.
 *
 * @param identity - Whose.
 * @returns The socket and its messages.
 */
function socketOf(identity: Identity): { socket: PackageLiveSocket; told: WsServerMessage[] } {
  const told: WsServerMessage[] = [];

  return {
    socket: {
      identity,
      packageTopics: new Set(),
      send: (message) => {
        told.push(message);
      },
      traceId: 'trace-1',
    },
    told,
  };
}

/**
 * Waits until a condition holds, polling.
 *
 * @param condition - What to wait for.
 */
async function until(condition: () => boolean): Promise<void> {
  const deadline = Date.now() + 2000;

  while (!condition()) {
    if (Date.now() > deadline) {
      throw new Error('Timed out waiting');
    }

    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

describe('a package’s live channel on the socket', () => {
  it('hands a new follower the retained message, and counts the topics it follows', async () => {
    const transport = new FakeTransport();
    const events = new EventFanout(logger);
    const { socket, told } = socketOf(identityWith('package:read'));

    events.start(new BusClient({ transport, source: 'api', logger }));
    new BusClient({ transport, source: 'music', logger }).publish(
      busSubjects.packageLive('music'),
      {
        topic: 'overview',
        data: { playing: 1 },
        isRetained: true,
      },
    );
    await until(() => events.retained('music', 'overview') !== undefined);

    handlePackageLive({ bus: undefined, events }, socket, {
      type: 'package_subscribe',
      packageId: 'music',
      topic: 'overview',
    });
    events.stop();

    expect(told).toEqual([
      { type: 'package_message', packageId: 'music', topic: 'overview', data: { playing: 1 } },
    ]);
    expect(socket.packageTopics.has(liveKey('music', 'overview'))).toBe(true);

    for (let index = 1; index < WS_MAX_PACKAGE_TOPICS; index += 1) {
      socket.packageTopics.add(liveKey('music', `topic${String(index)}`));
    }

    handlePackageLive({ bus: undefined, events }, socket, {
      type: 'package_subscribe',
      packageId: 'music',
      topic: 'one-more',
    });

    expect(told.at(-1)).toMatchObject({ type: 'error', code: 'VALIDATION' });

    handlePackageLive({ bus: undefined, events }, socket, {
      type: 'package_unsubscribe',
      packageId: 'music',
      topic: 'overview',
    });

    expect(socket.packageTopics.has(liveKey('music', 'overview'))).toBe(false);
  });

  it('passes a message on with who sent it, and refuses whoever may not read packages', async () => {
    const transport = new FakeTransport();
    const bus = new BusClient({ transport, source: 'api', logger });
    const events = new EventFanout(logger);
    const received: PackageLiveInbox[] = [];
    const reader = socketOf(identityWith('package:read'));
    const stranger = socketOf(identityWith('entity:read'));

    new BusClient({ transport, source: 'music', logger }).subscribe(
      busSubjects.packageLiveInbox('music'),
      packageLiveInboxSchema,
      (message) => {
        received.push(message);
      },
    );

    for (const { socket } of [stranger, reader]) {
      handlePackageLive({ bus, events }, socket, {
        type: 'package_send',
        packageId: 'music',
        topic: 'browser',
        data: { playback: 'paused' },
      });
      handlePackageLive({ bus, events }, socket, {
        type: 'package_subscribe',
        packageId: 'music',
        topic: 'browser.ab12',
      });
    }

    await until(() => received.length > 0);

    expect(received).toEqual([
      {
        topic: 'browser',
        data: { playback: 'paused' },
        caller: { userId: '00000000-0000-4000-8000-000000000001', username: 'ada', role: 'member' },
      },
    ]);
    expect(stranger.told).toMatchObject([
      { type: 'error', code: 'PERMISSION' },
      { type: 'error', code: 'PERMISSION' },
    ]);
    expect(stranger.socket.packageTopics.size).toBe(0);
    expect(reader.told).toEqual([]);
  });
});

describe('the topics a socket may follow', () => {
  it('take what the page listing the same things takes, and leave the rest open', () => {
    const guest = identityWith('entity:read', 'area:read');
    const admin = identityWith('device:read', 'container:read', 'settings:read', 'package:read');

    for (const topic of [
      'discovery',
      'containers',
      'backups',
      'packages',
      'automations',
    ] as const) {
      expect(missingTopicPermission(guest, topic)).toBeDefined();
    }

    expect(missingTopicPermission(admin, 'containers')).toBeUndefined();
    expect(missingTopicPermission(admin, 'automations')).toBe('automation:read');
    // What the broker pages are told travels on discovery: their reads take device:read too.
    expect(missingTopicPermission(identityWith('device:read'), 'discovery')).toBeUndefined();

    for (const topic of ['state', 'devices', 'library', 'system'] as const) {
      expect(missingTopicPermission(guest, topic)).toBeUndefined();
    }
  });
});

describe('the entities a socket is told about', () => {
  it('are narrowed from what it may read, so a wider filter widens them again', () => {
    const permitted = new Set(['light.hall', 'light.porch', 'switch.fan']);

    expect(narrowReadable(permitted, new Set(['light.hall', 'lock.door']))).toEqual(
      new Set(['light.hall']),
    );
    expect(narrowReadable(permitted, new Set(['light.hall', 'light.porch']))).toEqual(
      new Set(['light.hall', 'light.porch']),
    );
    expect(narrowReadable(permitted, undefined)).toEqual(permitted);
  });

  it('are read again one at a time, a burst of changes making one more read', async () => {
    let reads = 0;
    let finish: () => void = () => undefined;
    const reread = singleFlight(
      async () => {
        reads += 1;
        await new Promise<void>((resolve) => {
          finish = resolve;
        });
      },
      () => undefined,
    );

    reread();
    reread();
    reread();
    finish();
    await until(() => reads === 2);
    finish();
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(reads).toBe(2);
  });
});

describe('a socket’s budget', () => {
  it('lets a burst through up to its depth, then refills at the rate', () => {
    const budget = { tokens: WS_CLIENT_MESSAGES_PER_SECOND, at: 0 };
    let sent = 0;

    while (spend(budget, 0)) {
      sent += 1;
    }

    expect(sent).toBe(WS_CLIENT_MESSAGES_PER_SECOND);
    expect(spend(budget, 10)).toBe(false);
    expect(spend(budget, 20)).toBe(true);
    expect(spend(budget, 10_000)).toBe(true);
    expect(budget.tokens).toBe(WS_CLIENT_MESSAGES_PER_SECOND - 1);
  });
});

describe('the entities sockets read again after a registry change', () => {
  /**
   * Someone signed in with grants of their own.
   *
   * @param grants - What they are allowed and denied, as `[effect, key, scope]`.
   * @returns Their identity.
   */
  function identityGranted(...grants: (readonly ['allow' | 'deny', string, string])[]): Identity {
    return {
      ...identityWith(),
      permissions: grants.map(([effect, key, scope]) => ({ key, scope, effect })),
    };
  }

  it('are read once for sockets with the same grants, and apart for different ones', async () => {
    const asked: Identity[] = [];
    const read = sharedReads(async (identity) => {
      asked.push(identity);

      return Promise.resolve(new Set([identity.permissions.map((grant) => grant.scope).join()]));
    });
    const everything = identityGranted(['allow', 'entity:read', '*'], ['allow', 'area:read', '*']);
    const sameInAnotherOrder = identityGranted(
      ['allow', 'area:read', '*'],
      ['allow', 'entity:read', '*'],
    );
    const oneRoom = identityGranted(['allow', 'entity:read', 'area.kitchen']);
    const allButOneRoom = identityGranted(
      ['allow', 'entity:read', '*'],
      ['deny', 'entity:read', 'area.kitchen'],
    );

    const [first, second, kitchen, rest] = await Promise.all([
      read(everything),
      read(sameInAnotherOrder),
      read(oneRoom),
      read(allButOneRoom),
    ]);

    expect(asked).toEqual([everything, oneRoom, allButOneRoom]);
    expect(second).toBe(first);
    expect(kitchen).toEqual(new Set(['area.kitchen']));
    expect(rest).toEqual(new Set(['*,area.kitchen']));
  });

  it('are read anew by a socket that asks once the turn they were asked in is over', async () => {
    let reads = 0;
    const read = sharedReads(async () => {
      reads += 1;

      return Promise.resolve(new Set<string>());
    });
    const identity = identityWith('entity:read');

    await read(identity);
    await read(identity);

    expect(reads).toBe(2);
  });

  it('tell grants apart by their effect, key and scope, and not by their order', () => {
    expect(grantsKey(identityWith('entity:read', 'area:read').permissions)).toBe(
      grantsKey(identityWith('area:read', 'entity:read').permissions),
    );
    expect(grantsKey([{ key: 'entity:read', scope: 'area.kitchen', effect: 'allow' }])).not.toBe(
      grantsKey([{ key: 'entity:read', scope: 'area.kitchen', effect: 'deny' }]),
    );
  });
});

describe('a message sent to many sockets', () => {
  it('is written once, and each message as itself', () => {
    const message: WsServerMessage = { type: 'library_event', kind: 'areas' };
    const first = serializeMessage(message);

    expect(serializeMessage(message)).toBe(first);
    expect(JSON.parse(first)).toEqual(message);
    expect(serializeMessage({ type: 'pong' })).toBe('{"type":"pong"}');
  });
});
