import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createLinuxSerialHost } from './host.js';

let root = '';
let canLink = true;

/**
 * Writes sysfs attributes.
 *
 * @param directory - Where.
 * @param attributes - Each file and its text.
 * @returns Once written.
 */
async function attributes(directory: string, attributes: Record<string, string>): Promise<void> {
  await mkdir(directory, { recursive: true });
  await Promise.all(
    Object.entries(attributes).map(async ([name, text]) =>
      writeFile(path.join(directory, name), `${text}\n`),
    ),
  );
}

/**
 * Links a tty to its device, as sysfs does.
 *
 * @param name - The tty.
 * @param device - Its device directory.
 * @returns Once linked.
 */
async function tty(name: string, device: string): Promise<void> {
  await mkdir(path.join(root, 'sys', 'class', 'tty', name), { recursive: true });
  await mkdir(device, { recursive: true });
  // A junction needs no privilege on Windows, where these tests run in development too.
  await symlink(device, path.join(root, 'sys', 'class', 'tty', name, 'device'), 'junction');
}

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'nebula-serial-'));

  const usb = path.join(root, 'sys', 'devices', 'pci0000.00', 'usb1', '1-1');
  const uart = path.join(root, 'sys', 'devices', 'platform', 'serial8250');

  try {
    await attributes(usb, {
      idVendor: '10C4',
      idProduct: 'ea60',
      serial: 'a1b2',
      manufacturer: 'Silicon Labs',
      product: 'CP2102N USB to UART Bridge Controller',
    });
    await tty('ttyUSB0', path.join(usb, '1-1.1.0', 'ttyUSB0'));
    await tty('ttyS0', path.join(uart, 'tty', 'ttyS0'));
    await tty('ttyS1', path.join(uart, 'tty', 'ttyS1'));
    await tty('ttyS2', path.join(uart, 'tty', 'ttyS2'));
    await attributes(path.join(root, 'sys', 'class', 'tty', 'ttyS0'), { type: '4' });
    await attributes(path.join(root, 'sys', 'class', 'tty', 'ttyS1'), { type: '0' });
    await attributes(path.join(root, 'sys', 'class', 'tty', 'ttyS2'), { type: '4' });
    await mkdir(path.join(root, 'sys', 'class', 'tty', 'tty0'), { recursive: true });
    await attributes(path.join(root, 'dev'), { ttyUSB0: '', ttyS0: '', ttyS1: '', tty0: '' });
    await mkdir(path.join(root, 'dev', 'serial', 'by-id'), { recursive: true });
    await symlink(
      path.join('..', '..', 'ttyUSB0'),
      path.join(root, 'dev', 'serial', 'by-id', 'usb-Silicon_Labs_CP2102N-if00-port0'),
      'file',
    );
  } catch (error: unknown) {
    // A file link needs a privilege some Windows accounts lack; Linux always can.
    if ((error as NodeJS.ErrnoException).code !== 'EPERM') {
      throw error;
    }

    canLink = false;
  }
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('the Linux serial host', () => {
  it('lists the ttys with a device and a node, USB ones by their adapter', async (context) => {
    if (!canLink) {
      context.skip();
    }

    const ports = await createLinuxSerialHost({ root }).list();

    expect(
      ports.toSorted((left, right) => left.devicePath.localeCompare(right.devicePath)),
    ).toEqual([
      {
        devicePath: path.join(root, 'dev', 'ttyS0'),
        stablePath: path.join(root, 'dev', 'ttyS0'),
        kind: 'builtin',
        usb: null,
      },
      {
        devicePath: path.join(root, 'dev', 'ttyUSB0'),
        stablePath: path.join(
          root,
          'dev',
          'serial',
          'by-id',
          'usb-Silicon_Labs_CP2102N-if00-port0',
        ),
        kind: 'usb',
        usb: {
          vendorId: '10c4',
          productId: 'ea60',
          serialNumber: 'a1b2',
          manufacturer: 'Silicon Labs',
          product: 'CP2102N USB to UART Bridge Controller',
        },
      },
    ]);
  });

  it('sees nothing on a machine without sysfs', async () => {
    expect(await createLinuxSerialHost({ root: path.join(root, 'missing') }).list()).toEqual([]);
  });
});
