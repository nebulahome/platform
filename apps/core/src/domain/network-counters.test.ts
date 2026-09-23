import { describe, expect, it } from 'vitest';

import { defaultRouteInterface, parseNetstatE, parseProcNetDev } from './network-counters.js';

/** `/proc/net/dev` on a machine running Docker: the loopback, the uplink, a bridge. */
const PROC_NET_DEV = [
  'Inter-|   Receive                                                |  Transmit',
  ' face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed',
  '    lo:  500000    100    0    0    0     0          0         0   500000    100    0    0    0     0       0          0',
  '  eth0:12345678901  9000    0    0    0     0          0         0  2345678   7000    0    0    0     0       0          0',
  'docker0:  700000    300    0    0    0     0          0         0   900000    400    0    0    0     0       0          0',
  '',
].join('\n');

/** `/proc/net/route` with the default route out of eth0 and a second, costlier one. */
const PROC_NET_ROUTE = [
  'Iface\tDestination\tGateway \tFlags\tRefCnt\tUse\tMetric\tMask\t\tMTU\tWindow\tIRTT',
  'wlan0\t00000000\t0102A8C0\t0003\t0\t0\t600\t00000000\t0\t0\t0',
  'eth0\t00000000\t0101A8C0\t0003\t0\t0\t100\t00000000\t0\t0\t0',
  'eth0\t0001A8C0\t00000000\t0001\t0\t0\t100\t00FFFFFF\t0\t0\t0',
  'docker0\t000011AC\t00000000\t0001\t0\t0\t0\t0000FFFF\t0\t0\t0',
  '',
].join('\n');

describe('defaultRouteInterface', () => {
  it('picks the interface the cheapest default route leaves by', () => {
    expect(defaultRouteInterface(PROC_NET_ROUTE)).toBe('eth0');
  });

  it('finds none in a table without a default route', () => {
    expect(
      defaultRouteInterface(PROC_NET_ROUTE.split('\n').slice(0, 1).join('\n')),
    ).toBeUndefined();
  });
});

describe('parseProcNetDev', () => {
  it('reads one interface, even when its first number touches the colon', () => {
    expect(parseProcNetDev(PROC_NET_DEV, 'eth0')).toEqual({
      interface: 'eth0',
      receivedBytes: 12_345_678_901,
      transmittedBytes: 2_345_678,
    });
  });

  it('sums every interface but the loopback when none is named', () => {
    expect(parseProcNetDev(PROC_NET_DEV, undefined)).toEqual({
      interface: null,
      receivedBytes: 12_345_678_901 + 700_000,
      transmittedBytes: 2_345_678 + 900_000,
    });
  });

  it('finds nothing for an interface that is not there', () => {
    expect(parseProcNetDev(PROC_NET_DEV, 'wlan0')).toBeUndefined();
  });
});

describe('parseNetstatE', () => {
  it('reads the bytes line of an English Windows', () => {
    const text = [
      'Interface Statistics',
      '',
      '                           Received            Sent',
      '',
      'Bytes                    3106452883      289462510',
      'Unicast packets             3285036        1692108',
      'Non-unicast packets            4523           1210',
      '',
    ].join('\r\n');

    expect(parseNetstatE(text)).toEqual({
      interface: null,
      receivedBytes: 3_106_452_883,
      transmittedBytes: 289_462_510,
    });
  });

  it('reads the bytes line of an Italian Windows, by its shape rather than its words', () => {
    const text = [
      'Statistiche interfaccia',
      '',
      '                           Ricevuti            Inviati',
      '',
      'Byte                     1234567890      123456789',
      'Pacchetti unicast           1000000         900000',
      '',
    ].join('\r\n');

    expect(parseNetstatE(text)?.receivedBytes).toBe(1_234_567_890);
  });

  it('finds nothing in output without a line of counts', () => {
    expect(parseNetstatE('The system cannot find the file specified.')).toBeUndefined();
  });
});
