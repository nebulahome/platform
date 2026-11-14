/**
 * The audit entry a route writes around an action, however the action ends.
 */
import { describe, expect, it, vi } from 'vitest';

import { ConflictError } from '@nebulahome/contracts';

import { audited, type AuditEntry, type AuditRoute } from './audit.js';

/** Who asked, and from where. */
const route: AuditRoute = {
  identity: undefined,
  request: { ip: '192.168.1.20', traceId: 'trace-1' },
};

/** What is done, to what. */
const entry = { action: 'package.install', resourceType: 'package', resourceId: 'music' };

/**
 * An audit log that keeps what it is handed.
 *
 * @returns The log and the entries it got.
 */
function createAudit(): {
  audit: { record: (entry: AuditEntry) => Promise<void> };
  entries: AuditEntry[];
} {
  const entries: AuditEntry[] = [];

  const record = vi.fn((each: AuditEntry) => {
    entries.push(each);

    return Promise.resolve();
  });

  return { audit: { record }, entries };
}

describe('audited', () => {
  it('records a success with the details of its result, or none', async () => {
    const { audit, entries } = createAudit();

    await audited(
      audit,
      route,
      entry,
      () => Promise.resolve('done'),
      (result) => ({ result }),
    );
    await audited(audit, route, entry, () => Promise.resolve('done'));

    expect(entries).toEqual([
      {
        ...entry,
        result: 'success',
        identity: route.identity,
        ipAddress: '192.168.1.20',
        traceId: 'trace-1',
        details: { result: 'done' },
      },
      {
        ...entry,
        result: 'success',
        identity: route.identity,
        ipAddress: '192.168.1.20',
        traceId: 'trace-1',
      },
    ]);
    expect(entries[1]).not.toHaveProperty('details');
  });

  it('records a conflict as denied, anything else as a failure, and throws on', async () => {
    const { audit, entries } = createAudit();

    await expect(
      audited(audit, route, entry, () => Promise.reject(new ConflictError('busy'))),
    ).rejects.toThrow('busy');
    await expect(
      audited(audit, route, entry, () => Promise.reject(new Error('broken'))),
    ).rejects.toThrow('broken');

    expect(entries.map((each) => each.result)).toEqual(['denied', 'failure']);
  });
});
