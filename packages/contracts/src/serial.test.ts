import { describe, expect, it } from 'vitest';

import {
  serialClaimSchema,
  serialConsoleWriteRequestSchema,
  serialDeviceConfigSchema,
  serialLineSchema,
  serialLineText,
  serialNetworkPortSaveRequestSchema,
} from './serial.js';

describe('serialLineSchema', () => {
  it('fills a driver default block to 8N1 with no flow control', () => {
    expect(serialLineSchema.parse({ baudRate: 2400 })).toEqual({
      baudRate: 2400,
      dataBits: 8,
      parity: 'none',
      stopBits: 1,
      flowControl: 'none',
    });
  });

  it('refuses framings a UART cannot do', () => {
    expect(serialLineSchema.safeParse({ baudRate: 9600, dataBits: 9 }).success).toBe(false);
    expect(serialLineSchema.safeParse({ baudRate: 9600, stopBits: 3 }).success).toBe(false);
    expect(serialLineSchema.safeParse({ baudRate: 0 }).success).toBe(false);
    expect(serialLineSchema.safeParse({ baudRate: 9600, speed: 1 }).success).toBe(false);
  });
});

describe('serialLineText', () => {
  it('writes a line as the pages show it', () => {
    expect(serialLineText(serialLineSchema.parse({ baudRate: 9600 }))).toBe('9600 8N1');
    expect(
      serialLineText(
        serialLineSchema.parse({ baudRate: 115_200, dataBits: 7, parity: 'even', stopBits: 2 }),
      ),
    ).toBe('115200 7E2');
  });
});

describe('serialDeviceConfigSchema', () => {
  it('takes the port and line a serial device keeps', () => {
    const config = serialDeviceConfigSchema.parse({
      portId: '0192f6a4-5b6c-7d8e-9f01-23456789abcd',
      line: { baudRate: 2400 },
    });

    expect(config.line.parity).toBe('none');
  });
});

describe('serialNetworkPortSaveRequestSchema', () => {
  it('takes a ser2net port, raw TCP unless said', () => {
    expect(
      serialNetworkPortSaveRequestSchema.parse({
        name: 'Garage RS485',
        host: '192.168.1.50',
        port: 6638,
      }).protocol,
    ).toBe('raw');
  });

  it('refuses a host with a scheme or a path', () => {
    expect(
      serialNetworkPortSaveRequestSchema.safeParse({
        name: 'Bridge',
        host: 'tcp://192.168.1.50',
        port: 6638,
      }).success,
    ).toBe(false);
  });
});

describe('serialConsoleWriteRequestSchema', () => {
  it('keeps bytes as lower-case hex', () => {
    expect(serialConsoleWriteRequestSchema.parse({ consoleId: 'c1', data: '0D0A' }).data).toBe(
      '0d0a',
    );
  });

  it('refuses half a byte', () => {
    expect(
      serialConsoleWriteRequestSchema.safeParse({ consoleId: 'c1', data: 'abc' }).success,
    ).toBe(false);
  });
});

describe('serialClaimSchema', () => {
  it('tells an integration rule from a broker that recognises a radio', () => {
    expect(
      serialClaimSchema.parse({ kind: 'broker', broker: 'thread', model: 'SkyConnect' }).kind,
    ).toBe('broker');
    expect(
      serialClaimSchema.safeParse({ kind: 'broker', broker: 'modbus', model: null }).success,
    ).toBe(false);
  });
});
