import { NodeId } from '@matter/main';
import { describe, expect, it } from 'vitest';

import { jsonValueSchema } from '@nebulahome/contracts';

import {
  commissioningStepOf,
  commissionRequestOf,
  deviceNetworkOf,
  isMissingNetworkFailure,
  isTestCertificateFailure,
  jsonSafe,
  readNode,
} from './fabric.js';

describe('commissionRequestOf', () => {
  it('asks for a shared device over the network only, by its manual code or QR text', () => {
    expect(commissionRequestOf(NodeId(9n), '34970112332')).toEqual({
      nodeId: NodeId(9n),
      onNetworkOnly: true,
      manualCode: '34970112332',
    });
    expect(commissionRequestOf(NodeId(9n), 'MT:Y.K9042C00KA0648G00')).toEqual({
      nodeId: NodeId(9n),
      onNetworkOnly: true,
      qrCode: 'MT:Y.K9042C00KA0648G00',
    });
  });

  it('asks for a new device over Bluetooth too, with the networks there are for it', () => {
    expect(
      commissionRequestOf(NodeId(9n), '34970112332', {
        wifi: { ssid: 'Casa', password: 'secret-pass' },
        threadDataset: '0e08aabb',
      }),
    ).toEqual({
      nodeId: NodeId(9n),
      onNetworkOnly: false,
      manualCode: '34970112332',
      wifiCredentials: { wifiSsid: 'Casa', wifiCredentials: 'secret-pass' },
      threadCredentials: { operationalDataset: '0e08aabb' },
    });
    expect(
      commissionRequestOf(NodeId(9n), '34970112332', { wifi: null, threadDataset: null }),
    ).toEqual({ nodeId: NodeId(9n), onNetworkOnly: false, manualCode: '34970112332' });
  });
});

describe('deviceNetworkOf', () => {
  it("reads a new device's network from the commissioner's lines", () => {
    expect(deviceNetworkOf('Configuring WiFi network ...')).toBe('wifi');
    expect(deviceNetworkOf('Commissionee does not support any Thread network interface')).toBe(
      'wifi',
    );
    expect(deviceNetworkOf('Configuring Thread network ...')).toBe('thread');
    expect(deviceNetworkOf('Commissionee does not support any WiFi network interface')).toBe(
      'thread',
    );
    expect(deviceNetworkOf('WiFi network is not configured')).toBeUndefined();
  });

  it('tells a device given no network', () => {
    expect(
      isMissingNetworkFailure(
        'Commission failed: No Wi-Fi/Thread network credentials are configured for commissioning',
      ),
    ).toBe(true);
    expect(isMissingNetworkFailure('Commission failed: PASE timed out')).toBe(false);
  });
});

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
