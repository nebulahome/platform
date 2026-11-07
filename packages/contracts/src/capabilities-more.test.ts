/**
 * The capabilities the entity dialog's design asked for: each addition is optional or has a
 * default that keeps today's meaning, so what adapters already report and send still parses -
 * and parses to what it did.
 */
import { describe, expect, it } from 'vitest';

import {
  CAPABILITIES,
  CAPABILITY_DEFINITIONS,
  capabilityStateSchema,
  commandSchemaFor,
  type CapabilityName,
} from './capabilities.js';
import { DOMAIN_CAPABILITIES, ENTITY_DOMAINS } from './entity-id.js';
import { stateTokenChoices, stateTokenOf } from './entity-state-token.js';

/**
 * Parses a capability's params.
 *
 * @param capability - The capability.
 * @param params - What an adapter declares.
 * @returns The parsed params.
 */
function paramsOf(capability: CapabilityName, params: unknown): unknown {
  return CAPABILITY_DEFINITIONS[capability].params.parse(params);
}

/**
 * Whether a command is accepted by its capability's schema.
 *
 * @param capability - The capability.
 * @param command - The command.
 * @returns True when it parses.
 */
function accepts(capability: CapabilityName, command: unknown): boolean {
  return commandSchemaFor(capability)?.safeParse(command).success ?? false;
}

describe('what adapters already report', () => {
  it('parses as it did, the new params at their old meaning', () => {
    expect(paramsOf('on_off', {})).toEqual({ isAssumed: false });
    expect(paramsOf('color_hs', {})).toEqual({ hasWhiteChannel: false });
    expect(paramsOf('lock', { hasCode: true })).toEqual({ hasCode: true, canOpen: false });
    expect(paramsOf('camera', {})).toMatchObject({ hasMotionDetection: false });
    expect(paramsOf('media_player', {})).toMatchObject({
      hasVolume: true,
      canStop: true,
      canSkip: true,
      hasVolumeStep: false,
      hasShuffle: false,
      hasRepeat: false,
      soundModes: [],
    });
    expect(
      paramsOf('thermostat', { supportedModes: ['heat'], minTemperature: 5, maxTemperature: 30 }),
    ).toMatchObject({ hasTargetRange: false, hasTargetHumidity: false, presets: [], fanModes: [] });
    expect(paramsOf('vacuum', {})).toMatchObject({ canCleanSpot: false, fanSpeeds: [] });
    expect(paramsOf('sensor_text', {})).toEqual({ options: [] });
  });

  it('keeps every state an adapter sends today valid, with nothing added to it', () => {
    const today = {
      on_off: { isOn: true },
      color_hs: { hue: 30, saturation: 80 },
      color_temp: { mireds: 370 },
      lock: { lockState: 'jammed' },
      thermostat: {
        currentTemperature: 20.5,
        targetTemperature: 21,
        mode: 'heat',
        action: 'heating',
      },
      media_player: { playback: 'playing', volume: 40, isMuted: false },
      camera: { isStreamAvailable: true, isRecording: false },
      update: {
        installedVersion: '1.0',
        latestVersion: '1.1',
        isInstalling: false,
        progress: null,
      },
    };

    expect(capabilityStateSchema.parse(today)).toEqual(today);
  });
});

describe('the additions', () => {
  it('lets a lamp run an effect, and stop it with null', () => {
    expect(paramsOf('effect', { effects: ['Candle', 'Rainbow'] })).toEqual({
      effects: ['Candle', 'Rainbow'],
    });
    expect(capabilityStateSchema.parse({ effect: {} })).toEqual({ effect: { effect: null } });
    expect(accepts('effect', { command: 'set_effect', effect: 'Candle' })).toBe(true);
    expect(accepts('effect', { command: 'set_effect', effect: null })).toBe(true);
    expect(CAPABILITY_DEFINITIONS.effect.params.safeParse({ effects: [] }).success).toBe(false);
  });

  it("sets a lamp's white channel", () => {
    expect(accepts('color_hs', { command: 'set_white', white: 60 })).toBe(true);
    expect(accepts('color_hs', { command: 'set_white', white: 120 })).toBe(false);
  });

  it('opens a door with a lock that can pull its latch', () => {
    expect(accepts('lock', { command: 'open' })).toBe(true);
    expect(accepts('lock', { command: 'open', code: '1234' })).toBe(true);
    expect(
      capabilityStateSchema.safeParse({ lock: { lockState: 'unlocked', motion: 'opening' } })
        .success,
    ).toBe(true);
  });

  it('keeps a range, presets, fan modes and swings on a thermostat', () => {
    expect(
      capabilityStateSchema.safeParse({
        thermostat: {
          targetTemperature: 21,
          targetTemperatureLow: 19,
          targetTemperatureHigh: 24,
          mode: 'auto',
          action: 'defrosting',
          preset: null,
          fanMode: 'Low',
          swingMode: 'On',
        },
      }).success,
    ).toBe(true);
    expect(accepts('thermostat', { command: 'set_target_range', low: 19, high: 24 })).toBe(true);
    expect(accepts('thermostat', { command: 'set_preset', preset: 'Eco' })).toBe(true);
    expect(accepts('thermostat', { command: 'set_humidity', humidity: 45 })).toBe(true);
    expect(
      CAPABILITY_DEFINITIONS.thermostat.params.safeParse({
        supportedModes: ['heat'],
        minTemperature: 5,
        maxTemperature: 30,
        minHumidity: 80,
        maxHumidity: 40,
      }).success,
    ).toBe(false);
  });

  it('gives a fan speeds, presets, a swing and a direction', () => {
    expect(paramsOf('fan', {})).toEqual({
      speedCount: 0,
      presets: [],
      canOscillate: false,
      canReverse: false,
    });
    expect(accepts('fan', { command: 'set_percentage', percentage: 50 })).toBe(true);
    expect(accepts('fan', { command: 'set_direction', direction: 'reverse' })).toBe(true);
    expect(accepts('fan', { command: 'set_direction', direction: 'up' })).toBe(false);
  });

  it('places a phone by GPS and an event by its distance', () => {
    expect(capabilityStateSchema.parse({ location: {} })).toEqual({ location: { zone: null } });
    expect(
      capabilityStateSchema.safeParse({
        location: { zone: 'away', latitude: 45.07, longitude: 7.68, accuracyMeters: 12 },
      }).success,
    ).toBe(true);
    expect(capabilityStateSchema.safeParse({ location: { latitude: 120 } }).success).toBe(false);
    expect(paramsOf('location', {})).toEqual({ source: 'gps' });
  });

  it("links an update's notes only over http or https", () => {
    expect(
      capabilityStateSchema.safeParse({ update: { releaseUrl: 'https://example.com/notes' } })
        .success,
    ).toBe(true);
    expect(
      capabilityStateSchema.safeParse({ update: { releaseUrl: 'javascript:alert(1)' } }).success,
    ).toBe(false);
  });

  it('cleans a spot and sets suction, mode and water on a robot', () => {
    expect(accepts('vacuum', { command: 'clean_spot' })).toBe(true);
    expect(accepts('vacuum', { command: 'set_fan_speed', fanSpeed: 'Max' })).toBe(true);
    expect(accepts('vacuum', { command: 'set_clean_mode', cleanMode: 'mop' })).toBe(true);
    expect(
      capabilityStateSchema.safeParse({
        vacuum: {
          activity: 'docked',
          rooms: [
            {
              id: '1',
              name: 'Kitchen',
              outline: [
                [0, 0],
                [40, 0],
                [40, 30],
              ],
            },
          ],
        },
      }).success,
    ).toBe(true);
  });

  it('switches a player on and off, steps its volume and repeats', () => {
    expect(accepts('media_player', { command: 'volume_up' })).toBe(true);
    expect(accepts('media_player', { command: 'set_repeat', repeat: 'one' })).toBe(true);
    expect(accepts('media_player', { command: 'set_sound_mode', soundMode: 'Movie' })).toBe(true);
  });
});

describe('the domains', () => {
  it('say for each domain the capabilities it carries, all of them known', () => {
    for (const domain of ENTITY_DOMAINS) {
      const { oneOf, may } = DOMAIN_CAPABILITIES[domain];

      expect(oneOf.length).toBeGreaterThan(0);
      for (const capability of [...oneOf, ...may]) {
        expect(CAPABILITIES).toContain(capability);
      }
    }
  });

  it('reads a television that is switched off as off, and one that plays as playing', () => {
    const playing = { media_player: { playback: 'playing', volume: 10, isMuted: false } } as const;

    expect(stateTokenOf({ ...playing, on_off: { isOn: true } })).toBe('playing');
    expect(stateTokenOf({ ...playing, on_off: { isOn: false } })).toBe('off');
    expect(stateTokenOf(playing)).toBe('playing');
    expect(stateTokenChoices(['media_player', 'on_off'])).toContain('off');
    expect(stateTokenChoices(['media_player'])).not.toContain('off');
  });
});
