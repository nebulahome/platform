import { describe, expect, it } from 'vitest';

import { jsonValueSchema } from '@nebulahome/contracts';

import { commissioningStepOf, isTestCertificateFailure, jsonSafe, readNode } from './fabric.js';

describe('readNode', () => {
  it('reads the details, and lists a node whose details throw as unavailable', () => {
    const failures: unknown[] = [];
    const onFailure = (error: unknown): void => {
      failures.push(error);
    };

    expect(
      readNode(
        '7',
        () => ({
          node_id: 7n,
          available: true,
          attributes: { '0/40/1': 'Acme' },
          date_commissioned: '2026-10-20T10:00:00.000Z',
        }),
        onFailure,
      ),
    ).toStrictEqual({
      nodeId: '7',
      isAvailable: true,
      attributes: { '0/40/1': 'Acme' },
      commissionedAt: new Date('2026-10-20T10:00:00.000Z'),
    });
    expect(
      readNode(
        '8',
        () => {
          throw new TypeError("Cannot read properties of undefined (reading 'commissionedAt')");
        },
        onFailure,
      ),
    ).toStrictEqual({ nodeId: '8', isAvailable: false, attributes: {}, commissionedAt: null });
    expect(failures).toHaveLength(1);
  });
});

describe('jsonSafe', () => {
  it('drops what a struct left undefined and turns a bigint into a number or text', () => {
    const value = jsonSafe({ a: undefined, b: 1n, c: 2n ** 70n, d: [{ e: undefined }] });

    expect(value).toStrictEqual({ b: 1, c: '1180591620717411303424', d: [{}] });
    expect(jsonValueSchema.safeParse(value).success).toBe(true);
  });
});

describe('commissioningStepOf', () => {
  it("reads the step out of matter.js's line, and nothing out of another", () => {
    expect(
      commissioningStepOf(
        '2026-10-20 10:00:01.123 INFO ControllerCommissioningFlow Executing commissioning step 10.0: OperationalCredentials.DeviceAttestation',
      ),
    ).toBe(10);
    expect(commissioningStepOf('Executing commissioning step 0.0: GetInitialData')).toBe(0);
    expect(commissioningStepOf('Commissioning step 10.0 succeeded')).toBeUndefined();
  });
});

describe('isTestCertificateFailure', () => {
  it("tells the engine's sentence for a test certificate", () => {
    expect(
      isTestCertificateFailure(
        'Commission failed: This device uses a test/development certificate. To commission it, enable the "Test DCL" option',
      ),
    ).toBe(true);
    expect(isTestCertificateFailure('Commission failed: PASE timed out')).toBe(false);
  });
});
