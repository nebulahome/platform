import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { BusClient } from '@nebula-home/bus';
import { FakeTransport } from '@nebula-home/bus/testing';
import {
  accountStepSchema,
  busSubjects,
  HUB_ACCOUNT_BEGIN_METHOD,
  HUB_SERVICE,
  type AccountStatus,
} from '@nebula-home/contracts';
import { sealSecrets, secretsKeyFrom } from '@nebula-home/db';
import { createLogger } from '@nebula-home/logging';
import {
  accountDeclarationSchema,
  type AccountModule,
  type AccountModuleStep,
} from '@nebula-home/package-runtime';

import type { AccountStore, StoredAccount } from '../persistence/accounts.js';

import { AccountService, FLOW_TTL_MS } from './accounts.js';
import type { LoadedVendor } from './bundles.js';

/** The installation's key, as the tests seal with it. */
const KEY = secretsKeyFrom('0'.repeat(64));

/** What the owner types, as `api` sends it: the password sealed. */
const TYPED = sealSecrets(
  { email: 'owner@example.com', password: 'hunter2', country: 'IT' },
  ['password'],
  KEY,
);

/**
 * A cloud that emails a code the first time, and takes `123456`.
 *
 * @param seen - Where each call is written down.
 * @returns The module.
 */
function emailingCloud(seen: string[]): AccountModule {
  return {
    signIn: async (values): Promise<AccountModuleStep> => {
      seen.push(`signIn ${JSON.stringify(values['password'])}`);

      return Promise.resolve({
        kind: 'ask',
        message: 'The cloud emailed a code to o…@example.com',
        fields: [{ key: 'code', type: 'text', label: 'Code', isRequired: true, maxLength: 16 }],
        pending: { email: values['email'] ?? null },
      });
    },
    answer: async (pending, answers): Promise<AccountModuleStep> => {
      seen.push(`answer ${JSON.stringify(answers['code'])}`);

      return Promise.resolve(
        answers['code'] === '123456'
          ? {
              kind: 'connected',
              identity: {
                id: 'uid-42',
                label: typeof pending['email'] === 'string' ? pending['email'] : '?',
              },
              session: { token: 'secret-token' },
            }
          : { kind: 'failed', message: 'The code was not taken', field: 'code' },
      );
    },
    signOut: async (session): Promise<void> => {
      seen.push(`signOut ${JSON.stringify(session['token'])}`);

      return Promise.resolve();
    },
  };
}

/**
 * A store in memory.
 *
 * @returns The store, and what it holds.
 */
function memoryStore(): { store: AccountStore; rows: Map<string, StoredAccount> } {
  const rows = new Map<string, StoredAccount>();
  const keyOf = (vendorId: string, id: string): string => `${vendorId}/${id}`;

  return {
    rows,
    store: {
      load: async (vendorId) =>
        Promise.resolve([...rows.values()].filter((row) => row.vendorId === vendorId)),
      saveSignedIn: async (account) => {
        const row: StoredAccount = {
          ...account,
          status: 'connected',
          lastError: null,
          connectedAt: new Date(),
          updatedAt: new Date(),
        };

        rows.set(keyOf(account.vendorId, account.id), row);

        return Promise.resolve(row);
      },
      saveSession: async (vendorId, id, session) => {
        const row = rows.get(keyOf(vendorId, id));

        if (row !== undefined) {
          rows.set(keyOf(vendorId, id), { ...row, session });
        }

        return Promise.resolve();
      },
      saveStatus: async (vendorId, id, status: AccountStatus, lastError) => {
        const row = rows.get(keyOf(vendorId, id));

        if (row !== undefined) {
          rows.set(keyOf(vendorId, id), { ...row, status, lastError });
        }

        return Promise.resolve(row !== undefined);
      },
      delete: async (vendorId, id) => Promise.resolve(rows.delete(keyOf(vendorId, id))),
    },
  };
}

/**
 * A service over a fake bus, one vendor with an account.
 *
 * @param module - How the vendor signs in.
 * @param now - The clock.
 * @returns The service and what to look at.
 */
function harness(module: AccountModule, now: () => number = Date.now) {
  const transport = new FakeTransport();
  const logger = createLogger({ service: 'hub', version: '0.0.0', level: 'fatal' });
  const client = new BusClient({ transport, source: 'hub', logger, requestTimeoutMs: 500 });
  const caller = new BusClient({ transport, source: 'api', logger, requestTimeoutMs: 500 });
  const { store, rows } = memoryStore();
  const changed: string[] = [];
  const vendor = {
    manifest: { id: 'acme' },
    account: {
      declaration: accountDeclarationSchema.parse({
        name: 'Acme account',
        fields: {
          fields: [
            { key: 'email', type: 'text', label: 'Email', isRequired: true },
            { key: 'password', type: 'secret', label: 'Password', isRequired: true },
          ],
        },
        identity: 'email',
        module: './cloud/sign-in.js',
      }),
      module,
    },
  } as unknown as LoadedVendor;
  const service = new AccountService({
    client,
    store,
    logger,
    secretsKey: KEY,
    vendors: () => [vendor],
    onSignedInOrOut: async (vendorId) => {
      changed.push(vendorId);

      return Promise.resolve();
    },
    now,
  });

  return { service, caller, transport, rows, changed };
}

describe('AccountService', () => {
  it('asks for the emailed code, then keeps the account it signed in to', async () => {
    const seen: string[] = [];
    const { service, rows, changed, transport } = harness(emailingCloud(seen));

    const first = await service.begin('acme', TYPED);

    // The module is handed the password opened, never the sealed marker.
    expect(seen).toEqual(['signIn "hunter2"']);
    expect(first).toMatchObject({ kind: 'ask', fields: [{ key: 'code' }] });

    if (first.kind !== 'ask') {
      throw new Error('not asked');
    }

    const done = await service.answer(first.flowId, { code: '123456' });

    expect(done).toMatchObject({
      kind: 'connected',
      account: { vendorId: 'acme', id: 'uid-42', label: 'owner@example.com', status: 'connected' },
    });
    // What was typed is kept as `api` sealed it, and the session beside it.
    expect(rows.get('acme/uid-42')?.credentials).toEqual(TYPED);
    expect(rows.get('acme/uid-42')?.session).toEqual({ token: 'secret-token' });
    expect(changed).toEqual(['acme']);
    expect(transport.published.map((each) => each.subject)).toContain(
      busSubjects.integrationEvent(),
    );
  });

  it('refuses an answer to a flow that is over, and one that is not what was asked', async () => {
    const { service } = harness(emailingCloud([]));
    const first = await service.begin('acme', TYPED);

    if (first.kind !== 'ask') {
      throw new Error('not asked');
    }

    await expect(service.answer(first.flowId, {})).rejects.toThrow('not what the sign-in asked');

    await service.answer(first.flowId, { code: 'wrong' });

    // A flow is answered once: a second answer finds it gone.
    await expect(service.answer(first.flowId, { code: '123456' })).rejects.toThrow('is over');
  });

  it('says a wrong code failed, naming the field', async () => {
    const { service } = harness(emailingCloud([]));
    const first = await service.begin('acme', TYPED);

    if (first.kind !== 'ask') {
      throw new Error('not asked');
    }

    expect(await service.answer(first.flowId, { code: 'wrong' })).toEqual({
      kind: 'failed',
      message: 'The code was not taken',
      field: 'code',
    });
  });

  it('forgets a flow nobody answered within a quarter of an hour', async () => {
    let now = 1_000_000;
    const { service } = harness(emailingCloud([]), () => now);
    const first = await service.begin('acme', TYPED);

    if (first.kind !== 'ask') {
      throw new Error('not asked');
    }

    now += FLOW_TTL_MS + 1;

    await expect(service.answer(first.flowId, { code: '123456' })).rejects.toThrow('is over');
  });

  it('turns a module that throws into a failed step, in its words', async () => {
    const { service } = harness({
      signIn: async () => Promise.reject(new Error('The cloud is away')),
      answer: async () => Promise.reject(new Error('unused')),
    });

    expect(await service.begin('acme', TYPED)).toEqual({
      kind: 'failed',
      message: 'The cloud is away',
    });
  });

  it('hands a transport the account, renews its session and marks it for signing in again', async () => {
    const { service, rows } = harness(emailingCloud([]));
    const first = await service.begin('acme', TYPED);

    if (first.kind !== 'ask') {
      throw new Error('not asked');
    }

    await service.answer(first.flowId, { code: '123456' });

    const handle = await service.handleFor('acme', 'uid-42');

    expect(handle?.credentials['password']).toBe('hunter2');
    expect(handle?.session).toEqual({ token: 'secret-token' });

    await handle?.update({ token: 'renewed' });
    expect(rows.get('acme/uid-42')?.session).toEqual({ token: 'renewed' });

    await handle?.needsSignIn('The cloud wants a new code');
    expect(rows.get('acme/uid-42')).toMatchObject({
      status: 'needs-sign-in',
      lastError: 'The cloud wants a new code',
    });
    // One that needs signing in again is not handed to the listener.
    expect(await service.handlesOf('acme')).toEqual([]);
  });

  it('signs out at the cloud, forgets the account, and starts the vendor again', async () => {
    const seen: string[] = [];
    const { service, rows, changed } = harness(emailingCloud(seen));
    const first = await service.begin('acme', TYPED);

    if (first.kind !== 'ask') {
      throw new Error('not asked');
    }

    await service.answer(first.flowId, { code: '123456' });

    expect(await service.signOut('acme', 'uid-42')).toBe(true);
    expect(seen).toContain('signOut "secret-token"');
    expect(rows.size).toBe(0);
    expect(changed).toEqual(['acme', 'acme']);
    expect(await service.signOut('acme', 'uid-42')).toBe(false);
  });

  it('answers over the bus', async () => {
    const { service, caller } = harness(emailingCloud([]));
    const subscriptions = service.serve();

    const step = await caller.request(
      busSubjects.service(HUB_SERVICE, HUB_ACCOUNT_BEGIN_METHOD),
      { vendorId: 'acme', values: TYPED },
      accountStepSchema,
    );

    expect(step.kind).toBe('ask');

    await expect(
      caller.request(
        busSubjects.service(HUB_SERVICE, HUB_ACCOUNT_BEGIN_METHOD),
        { vendorId: 'nobody', values: {} },
        z.unknown(),
      ),
    ).rejects.toThrow();

    for (const subscription of subscriptions) {
      subscription.unsubscribe();
    }
  });
});
