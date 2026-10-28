import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createLinuxThreadHost, OTBR_CONF } from './host.js';

let root: string | undefined;

afterEach(async () => {
  if (root !== undefined) {
    await rm(root, { recursive: true, force: true });
    root = undefined;
  }
});

/**
 * A folder laid out as `/proc` and the border router's folder, written as a test says.
 *
 * @param files - Paths under `/proc`, and their text.
 * @returns The host over it, and where the border router's folder is.
 */
async function hostOver(files: Record<string, string>) {
  root = await mkdtemp(path.join(os.tmpdir(), 'nebula-thread-host-'));

  const proc = path.join(root, 'proc');

  for (const [name, text] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(proc, name)), { recursive: true });
    await writeFile(path.join(proc, name), text);
  }

  const configDir = path.join(root, 'data', 'hub', 'thread');

  return {
    host: createLinuxThreadHost({
      configDir,
      procDir: proc,
      agent: path.join(root, 'no-otbr-agent'),
    }),
    configDir,
  };
}

const IPV6_ROUTE = [
  'fd110022000000000000000000000000 40 00000000000000000000000000000000 00 00000000000000000000000000000000 00000100 00000001 00000000 00000001     wpan0',
  '00000000000000000000000000000000 00 00000000000000000000000000000000 00 fe800000000000000000000000000001 00000400 00000001 00000000 00000003     eth0',
  '00000000000000000000000000000000 00 00000000000000000000000000000000 00 00000000000000000000000000000000 ffffffff 00000001 00000000 00200200       lo',
].join('\n');

const IPV4_ROUTE = [
  'Iface\tDestination\tGateway \tFlags\tRefCnt\tUse\tMetric\tMask\t\tMTU\tWindow\tIRTT',
  'wlan0\t00000000\t0101A8C0\t0003\t0\t0\t600\t00000000\t0\t0\t0',
  'end0\t00000000\t0101A8C0\t0003\t0\t0\t100\t00000000\t0\t0\t0',
  'end0\t0001A8C0\t00000000\t0001\t0\t0\t100\t00FFFFFF\t0\t0\t0',
].join('\n');

describe('createLinuxThreadHost', () => {
  it("finds the interface of IPv6's default route, the loopback's unreachable one left out", async () => {
    const { host } = await hostOver({ 'net/ipv6_route': IPV6_ROUTE, 'net/route': IPV4_ROUTE });

    await expect(host.defaultInterface()).resolves.toBe('eth0');
  });

  it("falls back to IPv4's default route of the lowest metric, and to none", async () => {
    const { host } = await hostOver({ 'net/route': IPV4_ROUTE });

    await expect(host.defaultInterface()).resolves.toBe('end0');

    const { host: none } = await hostOver({});

    await expect(none.defaultInterface()).resolves.toBeNull();
  });

  it("reads an interface's IPv6 settings, and null for one that is not there", async () => {
    const { host } = await hostOver({ 'sys/net/ipv6/conf/eth0/accept_ra': '2\n' });

    await expect(host.ipv6Setting('eth0', 'accept_ra')).resolves.toBe('2');
    await expect(host.ipv6Setting('eth0', 'forwarding')).resolves.toBeNull();
  });

  it('writes otbr.conf with its two lines only, and removes it', async () => {
    const { host, configDir } = await hostOver({});
    const conf = path.join(configDir, OTBR_CONF);

    await host.writeConfig({
      radioUrl:
        'spinel+hdlc+uart:///dev/serial/by-id/usb-Nabu_Casa-if00-port0?uart-baudrate=460800',
      infraIf: 'eth0',
    });

    await expect(readFile(conf, 'utf8')).resolves.toBe(
      'RADIO_URL=spinel+hdlc+uart:///dev/serial/by-id/usb-Nabu_Casa-if00-port0?uart-baudrate=460800\nINFRA_IF=eth0\n',
    );

    await host.removeConfig();
    await host.removeConfig();

    await expect(readFile(conf, 'utf8')).rejects.toThrow(/ENOENT/u);
  });

  it('says no version where there is no otbr-agent', async () => {
    const { host } = await hostOver({});

    await expect(host.agentVersion()).resolves.toBeNull();
  });
});
