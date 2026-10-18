/**
 * The SDK end to end, on a copy of `tests/fixture`: an integration written as an author writes
 * one - a declarative light over HTTP, a transport of its own in TypeScript importing a sibling,
 * `$schema` in every JSON file - checked, built, packed and loaded the way `hub` loads it.
 */
import { cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { list } from 'tar';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildIntegration } from '../src/build.js';
import { checkIntegration } from '../src/check.js';
import { run } from '../src/cli/index.js';
import type { ManagedSocket, ManagedSocketOptions } from '../src/index.js';
import { packIntegration } from '../src/pack.js';
import { IntegrationError } from '../src/project.js';
import {
  createFakeSdk,
  driverHarness,
  identify,
  identifyMatter,
  loadIntegration,
  type FakeSdk,
} from '../src/testing/index.js';
import { SDK_VERSION } from '../src/version.js';

const FIXTURE = fileURLToPath(new URL('fixture', import.meta.url));

let root = '';

/**
 * Reads a JSON file of the copy.
 *
 * @param file - The file, relative to the copy.
 * @returns What it holds.
 */
async function readJson(file: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(path.join(root, file), 'utf8')) as Record<string, unknown>;
}

/**
 * Changes a JSON file of the copy.
 *
 * @param file - The file, relative to the copy.
 * @param change - What to make of what it holds.
 * @returns Once written.
 */
async function edit(
  file: string,
  change: (value: Record<string, unknown>) => Record<string, unknown>,
): Promise<void> {
  await writeFile(path.join(root, file), JSON.stringify(change(await readJson(file))));
}

/**
 * The problems a call throws.
 *
 * @param call - The call.
 * @returns Its problems.
 */
async function problemsOf(call: Promise<unknown>): Promise<readonly string[]> {
  try {
    await call;
  } catch (error: unknown) {
    if (error instanceof IntegrationError) {
      return error.problems;
    }

    throw error;
  }

  return [];
}

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'nebula-integration-sdk-'));
  await cp(FIXTURE, root, { recursive: true });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('validate', () => {
  it('passes sources that hold together, the way the hub reads them', async () => {
    const { project, declaration } = await checkIntegration({ root });

    expect([project.vendorId, project.version, declaration.manifest.version]).toEqual([
      'fixture',
      '0.2.0',
      '0.2.0',
    ]);
    expect(declaration.manifest.sdk).toBe(`^${SDK_VERSION.split('.').slice(0, 2).join('.')}.0`);
    expect(declaration.transports.map((module) => path.basename(module.path))).toEqual([
      'transport.ts',
    ]);
  });

  it('names the file and the field of a driver that does not hold', async () => {
    await edit('src/light/driver.json', (driver) => ({ ...driver, kind: 'shiny' }));

    const problems = await problemsOf(checkIntegration({ root }));

    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/^src\/light: driver\.json: kind: /u);
  });

  it('refuses a manifest that says what the build writes', async () => {
    await edit('src/manifest.json', (manifest) => ({ ...manifest, version: '9.9.9' }));

    expect((await problemsOf(checkIntegration({ root })))[0]).toMatch(/which the build writes/u);
  });

  it('says which module the bundle names is not there', async () => {
    await rm(path.join(root, 'src', 'lan', 'transport.ts'));

    expect((await problemsOf(checkIntegration({ root })))[0]).toMatch(
      /fixture transport lan names \.\/lan\/transport\.js, which is not in the bundle/u,
    );
  });
});

describe('build', () => {
  it('writes the vendor as the hub loads it: stamped, without $schema, its code compiled', async () => {
    const result = await buildIntegration({ root });
    const manifest = await readJson('dist/fixture/manifest.json');
    const driver = await readJson('dist/fixture/light/driver.json');
    const transport = await readFile(path.join(root, 'dist/fixture/lan/transport.js'), 'utf8');

    expect([result.files, result.modules]).toEqual([6, 1]);
    expect(Object.keys(manifest).slice(0, 3)).toEqual(['id', 'version', 'sdk']);
    expect([manifest['version'], manifest['$schema'], driver['$schema']]).toEqual([
      '0.2.0',
      undefined,
      undefined,
    ]);
    // The sibling it imports is in it, and nothing of the SDK but what the types said.
    expect(transport).toContain('"hello"');
    expect(transport).not.toMatch(/from ["']\.\/packet/u);
    // Nothing of the author's disk: no comment naming where each part came from.
    expect(transport).not.toContain('#region');
    await expect(readdir(path.join(root, 'dist/fixture/lan'))).resolves.toEqual(['transport.js']);
  });

  it("refuses code that brings a zod of its own instead of the hub's", async () => {
    await writeFile(
      path.join(root, 'src/lan/packet.ts'),
      "import { z } from 'zod';\nexport const PORT = 4003;\nexport const packetOf = (text: string): string => z.string().parse(text);\n",
    );

    expect((await problemsOf(buildIntegration({ root })))[0]).toMatch(/sdk\.z/u);
  });

  it('refuses an import nothing resolves, which an installed bundle could not load', async () => {
    const file = path.join(root, 'src/lan/packet.ts');

    await writeFile(
      file,
      `import 'left-pad';
${await readFile(file, 'utf8')}`,
    );

    expect((await problemsOf(buildIntegration({ root })))[0]).toMatch(
      /left-pad.*a bundle carries what its code imports/su,
    );
  });

  it('refuses a transport that calls itself something else, once loaded back', async () => {
    const file = path.join(root, 'src/lan/transport.ts');

    await writeFile(
      file,
      (await readFile(file, 'utf8')).replace("'fixture/lan'", "'fixture/wire'"),
    );

    expect((await problemsOf(buildIntegration({ root })))[0]).toMatch(
      /calls itself fixture\/wire; it must be fixture\/lan/u,
    );
  });
});

describe('pack', () => {
  it('packs the vendor folder into <vendor>-<version>.tgz, the same bytes every time', async () => {
    await buildIntegration({ root });

    const first = await packIntegration({ root, repository: null });
    const second = await packIntegration({ root, repository: null });
    const entries: string[] = [];

    await list({ file: first.archive, onReadEntry: (entry) => entries.push(entry.path) });

    expect(path.basename(first.archive)).toBe('fixture-0.2.0.tgz');
    expect(second.sha256).toBe(first.sha256);
    expect(entries).toContain('fixture/manifest.json');
    expect(entries).toContain('fixture/light/driver.json');
    expect(entries.every((entry) => entry.startsWith('fixture/'))).toBe(true);
  });

  it('refuses a release from a repository the Community Hub would not import it from', async () => {
    await buildIntegration({ root });

    const problems = await problemsOf(
      packIntegration({
        root,
        repository: 'someone/fixture-plugin',
      }),
    );
    const named = await packIntegration({
      root,
      repository: 'someone/integration-fixture',
    });

    expect(problems[0]).toMatch(/one called integration-fixture/u);
    expect(named.size).toBeGreaterThan(0);
  });

  it('asks for a build of the version package.json says', async () => {
    expect((await problemsOf(packIntegration({ root, repository: null })))[0]).toMatch(
      /run nebulahome-integration build/u,
    );
  });
});

describe('the command', () => {
  it('ends with 0 when the sources hold, 1 with what does not', async () => {
    expect(await run(['validate', '--root', root])).toBe(0);

    await edit('src/manifest.json', (manifest) =>
      Object.fromEntries(Object.entries(manifest).filter(([key]) => key !== 'name')),
    );

    expect(await run(['validate', '--root', root])).toBe(1);
    expect(await run(['explode', '--root', root])).toBe(1);
  });
});

describe('testing', () => {
  it('loads the sources as the hub loads a bundle, handing the code a fake SDK', async () => {
    const integration = await loadIntegration({ root });
    const [transport] = integration.vendor.ownTransports;

    await expect(transport?.probe({ host: '192.0.2.7' }, AbortSignal.timeout(1000))).resolves.toBe(
      '192.0.2.7 was greeted',
    );
    expect(integration.fake.udpSockets[0]?.sent).toEqual([
      { message: Buffer.from('{"msg":"hello"}'), port: 4003, address: '192.0.2.7' },
    ]);
    expect(integration.vendor.wires).toEqual(['http']);
  });

  it('loads the build too', async () => {
    await buildIntegration({ root });

    const integration = await loadIntegration({ root, from: 'build' });

    expect(integration.vendor.manifest.version).toBe('0.2.0');
  });

  it('drives a declarative driver: claim, describe, state and command', async () => {
    const integration = await loadIntegration({ root });
    const harness = driverHarness(integration.driver('light'), {
      options: { pollInterval: 10 },
      deviceId: 'hall',
    });
    const device = harness.add({
      deviceKey: '192.0.2.7',
      payload: { vendor: 'Fixture', id: 'fx-1', name: 'Hall', model: 'FX1' },
    });

    expect(harness.claim({ deviceKey: '192.0.2.8', payload: { vendor: 'Other' } })).toBeNull();
    expect(device.entityIds).toEqual(['light.hall']);
    expect(harness.receive({ on: true })).toEqual([
      expect.objectContaining({ entityId: 'light.hall', state: { on_off: { isOn: true } } }),
    ]);
    expect(harness.lastState('light.hall')).toEqual({ on_off: { isOn: true } });
    expect(harness.command('light.hall', 'on_off', { command: 'turn_off' })).toEqual({
      deviceKey: '192.0.2.7',
      op: 'post',
      args: { path: '/state', body: { on: false } },
    });
    expect(harness.subscriptions()[0]?.op).toBe('poll');
  });

  it('says what discovery makes of a device heard', async () => {
    const integration = await loadIntegration({ root });

    expect(
      identify(integration.vendor, {
        announcement: { instance: 'Hall', txt: { md: 'FX2', id: 'fx-2' } },
      }),
    ).toEqual({
      matches: true,
      identity: { externalId: 'fx-2', name: 'Hall', modelCode: 'FX2', swVersion: null },
      association: { driverId: 'light', model: 'Strip', modelChoices: ['Strip'] },
    });
  });

  it("says which of the house's Matter devices the vendor's rules take, and as which driver", async () => {
    const source = path.join(root, 'src');
    const discovery = JSON.parse(
      await readFile(path.join(source, 'discovery.json'), 'utf8'),
    ) as object;

    await writeFile(
      path.join(source, 'discovery.json'),
      JSON.stringify({ ...discovery, matter: { match: [{ path: 'vendorId', equals: 5264 }] } }),
    );
    await mkdir(path.join(source, 'matter'));
    await writeFile(
      path.join(source, 'matter', 'driver.json'),
      JSON.stringify({
        id: 'matter',
        name: 'Matter device',
        transport: 'matter',
        kind: 'matter',
        setup: './setup.json',
      }),
    );
    await writeFile(
      path.join(source, 'matter', 'setup.json'),
      JSON.stringify({ transport: { fields: [] } }),
    );

    const { vendor, failures } = await loadIntegration({ root });

    expect(failures).toEqual([]);
    expect(identifyMatter(vendor, { vendorId: 5264, productId: 4121 })).toEqual({
      matches: true,
      association: { driverId: 'matter', model: 'Matter device', modelChoices: ['Matter device'] },
    });
    expect(identifyMatter(vendor, { vendorId: 4107, productId: 4121 })).toEqual({
      matches: false,
      association: null,
    });
  });

  it('says which piece of the SDK a test did not fake', () => {
    const { sdk } = createFakeSdk();

    expect(() =>
      sdk.openMqtt({ url: 'mqtt://x', logger: sdk.logger, onMessage: () => undefined }),
    ).toThrow(/openMqtt is not faked/u);
  });
});

describe('fake WebSockets', () => {
  /** What a bundle's callbacks heard. */
  type Heard = { opens: number; messages: string[]; closes: [string, unknown][] };

  /**
   * Opens a WebSocket through a fake SDK, as a bundle would, recording what it hears.
   *
   * @param headers - The headers it opens with.
   * @returns The fake SDK, what the bundle holds, and what it heard.
   */
  function openThroughFake(headers?: ManagedSocketOptions['headers']): {
    fake: FakeSdk;
    socket: ManagedSocket;
    heard: Heard;
  } {
    const fake = createFakeSdk();
    const heard: Heard = { opens: 0, messages: [], closes: [] };
    const socket = fake.sdk.openWebSocket({
      url: 'wss://cloud.example/ws',
      ...(headers === undefined ? {} : { headers }),
      logger: fake.sdk.logger,
      onOpen: () => {
        heard.opens += 1;
      },
      onMessage: (text) => {
        heard.messages.push(text);
      },
      onClose: (reason, details) => {
        heard.closes.push([reason, details]);
      },
    });

    return { fake, socket, heard };
  }

  it('opens when the test says, carries frames both ways and keeps what was sent', async () => {
    const { fake, socket, heard } = openThroughFake({ username: 'access-id' });
    const [ws] = fake.webSockets;

    expect(ws?.url).toBe('wss://cloud.example/ws');
    expect(socket.isOpen).toBe(false);
    expect(() => {
      socket.send('too soon');
    }).toThrow(/not open/u);

    await ws?.open();
    ws?.deliver('{"messageId":"m1"}');
    socket.send('{"messageId":"m1"}');

    expect(ws?.headers).toEqual({ username: 'access-id' });
    expect(heard).toEqual({ opens: 1, messages: ['{"messageId":"m1"}'], closes: [] });
    expect(ws?.sent).toEqual(['{"messageId":"m1"}']);
  });

  it('drops and opens again, asking a header function each time', async () => {
    let calls = 0;
    const { fake, heard } = openThroughFake(async () => {
      calls += 1;

      return Promise.resolve({ authorization: `Bearer ${String(calls)}` });
    });
    const [ws] = fake.webSockets;

    await ws?.open();
    ws?.drop('connection lost', { code: 1006 });

    expect(ws?.isOpen).toBe(false);
    expect(() => ws?.deliver('late')).toThrow(/not open/u);

    await ws?.open();

    expect(ws?.headers).toEqual({ authorization: 'Bearer 2' });
    expect(heard.opens).toBe(2);
    expect(heard.closes).toEqual([['connection lost', { code: 1006 }]]);
  });

  it('refuses an attempt with its status, and stays closed when the bundle closes there', async () => {
    const fake = createFakeSdk();
    const socket = fake.sdk.openWebSocket({
      url: 'wss://cloud.example/ws',
      logger: fake.sdk.logger,
      onOpen: () => undefined,
      onMessage: () => undefined,
      onClose: (reason, details) => {
        if (details?.status === 401) {
          void socket.close();
        }
      },
    });
    const [ws] = fake.webSockets;

    ws?.drop('connection not accepted (HTTP 401 Unauthorized)', { code: 1006, status: 401 });

    expect(ws?.isClosed).toBe(true);
    await expect(ws?.open()).rejects.toThrow(/closed for good/u);
  });

  it('records a reset, and closes what the bundle left open on release', async () => {
    const { fake, socket, heard } = openThroughFake();
    const [ws] = fake.webSockets;

    await ws?.open();
    socket.reset('request timed out');

    expect(ws?.resets).toEqual(['request timed out']);
    expect(heard.closes).toEqual([['request timed out', {}]]);

    await ws?.open();
    await fake.release();

    expect(ws?.isClosed).toBe(true);
    expect(socket.isOpen).toBe(false);
  });

  it('gives way to a WebSocket the test passes itself', () => {
    const own: ManagedSocket = {
      isOpen: true,
      send: () => undefined,
      reset: () => undefined,
      close: () => Promise.resolve(),
    };
    const fake = createFakeSdk({ overrides: { openWebSocket: () => own } });

    expect(
      fake.sdk.openWebSocket({
        url: 'ws://x',
        logger: fake.sdk.logger,
        onOpen: () => undefined,
        onMessage: () => undefined,
        onClose: () => undefined,
      }),
    ).toBe(own);
    expect(fake.webSockets).toEqual([]);
  });
});
