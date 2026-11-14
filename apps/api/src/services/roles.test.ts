/**
 * Role changes against a database that answers in turn and records what was written.
 */
import { describe, expect, it } from 'vitest';

import { PermissionError, type Identity } from '@nebulahome/contracts';
import type { Database } from '@nebulahome/db';

import { databaseAnswering } from '../testing/hub-harness.js';

import { deleteRole, updateRole } from './roles.js';

const ROLE_ID = '00000000-0000-4000-8000-000000000001';
const OWNER_ID = '00000000-0000-4000-8000-000000000002';
const CONTROL = '00000000-0000-4000-8000-0000000000c1';
const READ = '00000000-0000-4000-8000-0000000000c2';

/**
 * A role row as the role list reads it.
 *
 * @param id - Its id.
 * @param key - Its key.
 * @param userCount - How many people hold it.
 * @returns The row.
 */
const roleRow = (id: string, key: string, userCount = 0): Record<string, unknown> => ({
  id,
  key,
  name: key,
  description: '',
  icon: null,
  isBuiltin: key === 'owner',
  sortOrder: 0,
  userCount,
});

/**
 * Someone holding the given permissions everywhere.
 *
 * @param keys - The permission keys.
 * @returns The identity.
 */
const holding = (...keys: string[]): Identity =>
  ({
    permissions: keys.map((key) => ({ key, scope: '*', effect: 'allow' })),
  }) as unknown as Identity;

/**
 * A database whose queries answer in turn, running a transaction on itself and keeping every call.
 *
 * @param answers - The rows of each awaited query, in order.
 * @returns The database and the calls made on it.
 */
function recording(...answers: readonly (readonly unknown[])[]): {
  db: Database;
  calls: { method: string; args: unknown[] }[];
} {
  const calls: { method: string; args: unknown[] }[] = [];
  let asked = 0;
  const chain: unknown = new Proxy(() => chain, {
    /**
     * Answers `then` with the next rows, `transaction` by running it here, the rest by recording.
     *
     * @param target - Ignored.
     * @param key - The property asked for.
     * @returns What the chain answers.
     */
    get: (target, key): unknown => {
      if (key === 'then') {
        return (resolve: (rows: readonly unknown[]) => void): void => {
          resolve(answers[asked] ?? []);
          asked += 1;
        };
      }

      if (key === 'transaction') {
        return (work: (tx: unknown) => Promise<unknown>): Promise<unknown> => work(chain);
      }

      return (...args: unknown[]): unknown => {
        calls.push({ method: String(key), args });

        return chain;
      };
    },
  });

  return { db: chain as Database, calls };
}

describe('updateRole', () => {
  it('keeps the scope of a grant the role keeps and adds only the new keys', async () => {
    const role = [roleRow(ROLE_ID, 'cook')];
    const grants = [{ roleId: ROLE_ID, key: 'entity:control', scope: 'area.kitchen' }];
    const { db, calls } = recording(
      role,
      grants,
      [
        { id: CONTROL, key: 'entity:control' },
        { id: READ, key: 'device:read' },
      ],
      [],
      [{ permissionId: CONTROL }],
      [],
      role,
      grants,
    );

    await updateRole(db, { has: () => true }, holding('entity:control', 'device:read'), ROLE_ID, {
      name: 'Chef',
      permissions: ['entity:control', 'device:read'],
    });

    expect(calls.some((call) => call.method === 'delete')).toBe(false);
    expect(calls.filter((call) => call.method === 'values').map((call) => call.args[0])).toEqual([
      [{ roleId: ROLE_ID, permissionId: READ }],
    ]);
  });
});

describe('deleteRole', () => {
  it('refuses to move people into a role granting what the caller does not hold', async () => {
    const db = databaseAnswering(
      [roleRow(ROLE_ID, 'cook', 2), roleRow(OWNER_ID, 'owner')],
      [{ roleId: OWNER_ID, key: 'system:admin', scope: '*' }],
      [{ id: OWNER_ID }],
      [roleRow(ROLE_ID, 'cook', 2), roleRow(OWNER_ID, 'owner')],
      [{ roleId: OWNER_ID, key: 'system:admin', scope: '*' }],
    );

    await expect(deleteRole(db, holding('role:manage'), ROLE_ID, 'owner')).rejects.toBeInstanceOf(
      PermissionError,
    );
  });
});
