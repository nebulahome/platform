/**
 * The test context against a server written as an author writes one: what it records, and the
 * platform's rules it keeps.
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { defineEntityType, defineSettings, field } from '../index.js';
import { defineServer } from '../server/index.js';

import { createTestContext } from './index.js';

const settings = defineSettings({
  city: field.text({ label: 'City', default: 'Turin' }),
  refreshMinutes: field.number({ label: 'Refresh every', default: 30, isLive: true }),
});

const note = defineEntityType({
  id: 'note',
  name: 'Note',
  icon: 'sticky-note',
  state: { text: field.text({ label: 'Text' }) },
  commands: { rename: { name: 'Rename', fields: { text: field.text({ label: 'Text' }) } } },
});

/** What the server heard of its settings. */
const heard: number[] = [];

const server = defineServer({
  settings,
  async start(ctx) {
    await ctx.devices.sync([
      {
        externalId: 'notes',
        name: 'Notes',
        entities: [
          { objectId: 'note', name: 'Note', type: note },
          {
            objectId: 'temperature',
            name: 'Temperature',
            domain: 'sensor',
            capabilities: { sensor_numeric: {} },
          },
        ],
      },
    ]);

    const notes = ctx.custom(note);

    notes.report(notes.entityId('note'), { text: `in ${ctx.settings.city}` });
    notes.onCommand('rename', ({ entityId, args }) => {
      notes.report(entityId, { text: args.text });
    });
    ctx.onSettingsChange(({ values }) => {
      heard.push(values.refreshMinutes);
    });
    ctx.rpc.method(
      'echo',
      { access: 'read', input: z.object({ text: z.string() }) },
      ({ text }) => ({
        text,
      }),
    );
    ctx.services.provide('count', () => 3);

    return undefined;
  },
});

describe('the live channel of a test context', () => {
  it('records what is published, and hands a sent message through its schema', async () => {
    const test = createTestContext({ id: 'music' });
    const heard: string[] = [];

    test.ctx.live.onMessage(
      'browser',
      { input: z.object({ browserId: z.string() }) },
      ({ browserId }, { caller }) => {
        heard.push(`${caller.username}:${browserId}`);
        test.ctx.live.publish(`browser.${browserId}`, { playback: 'paused' });
      },
    );
    test.ctx.live.publish('overview', { playing: 1 }, { isRetained: true });
    test.ctx.live.publish('Not a topic', 1);

    await test.sendLive('browser', { browserId: 'ab12' });

    expect(heard).toEqual(['test:ab12']);
    expect(test.published).toEqual([
      { topic: 'overview', data: { playing: 1 }, isRetained: true },
      { topic: 'browser.ab12', data: { playback: 'paused' }, isRetained: false },
    ]);
    expect(test.logs.some((line) => line.level === 'error')).toBe(true);
    await expect(test.sendLive('browser', { browserId: 3 })).rejects.toThrow(/refused/);
    await expect(test.sendLive('queue', {})).rejects.toThrow(/Nothing hears/);
    expect(() => test.ctx.live.onMessage('browser', () => undefined)).toThrow(/heard already/);
  });
});

describe('a test context', () => {
  it('records what the server registers and reports, settings defaults applied', async () => {
    const test = createTestContext({ id: 'note-taker', definition: settings });

    await server.start(test.ctx);

    expect(test.synced()?.[0]?.entities).toHaveLength(2);
    expect(test.reports.last('custom.note_taker_note')).toEqual({
      custom: { values: { text: 'in Turin' } },
    });
    expect(test.ctx.objectIdOf('custom.note_taker_note')).toBe('note');
    expect(test.ctx.objectIdOf('custom.other_note')).toBeUndefined();
  });

  it('routes a custom command to its type’s handler', async () => {
    const test = createTestContext({ id: 'notes', definition: settings });

    await server.start(test.ctx);
    await test.sendCommand({
      entityId: 'custom.notes_note',
      capability: 'custom',
      command: { command: 'rename', args: { text: 'Milk' } },
    });

    expect(test.reports.last('custom.notes_note')).toEqual({
      custom: { values: { text: 'Milk' } },
    });
  });

  it('delivers a live change, and tells a restart apart', async () => {
    const test = createTestContext({ definition: settings });

    await server.start(test.ctx);

    expect(await test.changeSettings({ refreshMinutes: 5 })).toEqual({ isRestart: false });
    expect(heard).toContain(5);
    expect(test.ctx.settings.refreshMinutes).toBe(5);
    expect(await test.changeSettings({ city: 'Milan' })).toEqual({ isRestart: true });
  });

  it('checks a method’s input, and keeps the platform’s rules', async () => {
    const test = createTestContext({ definition: settings });

    await server.start(test.ctx);

    expect(await test.callRpc('echo', { text: 'hi' })).toEqual({ text: 'hi' });
    await expect(test.callRpc('echo', { text: 1 })).rejects.toThrow('echo refused its input');
    expect(await test.callService('count')).toBe(3);
    expect(() => {
      test.ctx.services.provide('settings', () => null);
    }).toThrow('settings is a name the platform keeps for itself');
    expect(() => {
      test.ctx.devices.onCommand(() => undefined);
      test.ctx.devices.onCommand(() => undefined);
    }).toThrow('devices.onCommand has a handler already');
  });

  it('reads and follows the house', async () => {
    const snapshot = {
      entityId: 'sensor.kitchen_temperature',
      state: { sensor_numeric: { value: 21 } },
      attributes: {},
      isAvailable: true,
      lastChanged: '2026-10-02T08:00:00Z',
      lastUpdated: '2026-10-02T08:00:00Z',
    };
    const test = createTestContext({ entities: [snapshot] });
    const changes: string[] = [];

    test.ctx.entities.subscribe({ domain: 'sensor' }, (change) => {
      changes.push(change.entityId);
    });

    expect(await test.ctx.entities.get('sensor.kitchen_temperature')).toEqual(snapshot);
    expect(await test.ctx.entities.list({ domain: 'light' })).toEqual([]);
    await test.emitStateChange({ entityId: snapshot.entityId, current: snapshot });
    expect(changes).toEqual(['sensor.kitchen_temperature']);
  });
});

describe('the past of the house', () => {
  const point = (time: string, isOn: boolean) => ({
    time,
    state: { on_off: { isOn } },
    previousState: { on_off: { isOn: !isOn } },
    attributes: {},
    isAvailable: true,
    source: 'shelly',
  });

  it('reads the window oldest first, keeping the newest when there are too many', async () => {
    const test = createTestContext({
      history: {
        'light.hall': {
          states: [
            point('2026-10-02T09:00:00Z', false),
            point('2026-10-02T07:00:00Z', true),
            point('2026-10-01T23:00:00Z', false),
            point('2026-10-02T08:00:00Z', true),
          ],
        },
      },
    });
    const window = { from: '2026-10-02T00:00:00Z', to: '2026-10-03T00:00:00Z' };

    const all = await test.ctx.history.states({
      entityIds: ['light.hall', 'light.none'],
      ...window,
    });
    const two = await test.ctx.history.states({ entityIds: ['light.hall'], ...window, limit: 2 });

    expect(all.series['light.hall']?.map((each) => each.time)).toEqual([
      '2026-10-02T07:00:00Z',
      '2026-10-02T08:00:00Z',
      '2026-10-02T09:00:00Z',
    ]);
    expect(all.series['light.none']).toEqual([]);
    expect(all.truncated).toEqual([]);
    expect(two.series['light.hall']?.map((each) => each.time)).toEqual([
      '2026-10-02T08:00:00Z',
      '2026-10-02T09:00:00Z',
    ]);
    expect(two.truncated).toEqual(['light.hall']);
  });

  it('picks the resolution by the window, and refuses a window backwards', async () => {
    const test = createTestContext();

    test.setHistory('sensor.kitchen_temperature', {
      telemetry: [{ time: '2026-10-02T08:00:00Z', value: 21.5 }],
    });

    const day = await test.ctx.history.telemetry({
      entityIds: ['sensor.kitchen_temperature'],
      from: new Date('2026-10-02T00:00:00Z'),
      to: new Date('2026-10-03T00:00:00Z'),
    });

    expect(day.resolution).toBe('1m');
    expect(day.series['sensor.kitchen_temperature']).toEqual([
      { time: '2026-10-02T08:00:00Z', value: 21.5 },
    ]);
    await expect(
      test.ctx.history.states({
        entityIds: ['light.hall'],
        from: '2026-10-03T00:00:00Z',
        to: '2026-10-02T00:00:00Z',
      }),
    ).rejects.toThrow('The window starts at or after it ends');
  });
});
