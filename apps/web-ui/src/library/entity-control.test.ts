/**
 * The state, the limits and the permission scopes a control is drawn from.
 */
import { describe, expect, it } from 'vitest';

import { aTag, anEntity } from '@/testing/fixtures';

import {
  capabilityStateOf,
  entityScopesOf,
  hexToHs,
  hsColor,
  isCommandable,
  kelvinColor,
  kelvinToMireds,
  miredsToKelvin,
  paramsOf,
  powerCommand,
  warmthGradient,
} from './entity-control';

describe('capabilityStateOf', () => {
  it('prefers what the channel said over what the page loaded', () => {
    const relay = anEntity({ state: { on_off: { isOn: false } } });

    expect(capabilityStateOf(relay, undefined)).toEqual({ on_off: { isOn: false } });
    expect(capabilityStateOf(relay, { state: { on_off: { isOn: true } } })).toEqual({
      on_off: { isOn: true },
    });
  });

  it('answers empty for a state that has never arrived or does not read', () => {
    expect(capabilityStateOf(anEntity({ state: null }), undefined)).toEqual({});
    expect(capabilityStateOf(anEntity({ state: { level: { level: 400 } } }), undefined)).toEqual(
      {},
    );
  });
});

describe('paramsOf', () => {
  it('reads the limits a device declared, with the defaults filled in', () => {
    const cover = anEntity({
      entityId: 'cover.shutter',
      capabilities: [{ capability: 'cover', params: { hasPosition: true } }],
    });

    expect(paramsOf(cover, 'cover')).toEqual({ hasPosition: true, hasTilt: false });
    expect(paramsOf(cover, 'level')).toBeNull();
  });

  it('refuses a colour temperature range that is missing, rather than guessing one', () => {
    const lamp = anEntity({
      entityId: 'light.lamp',
      capabilities: [{ capability: 'color_temp', params: {} }],
    });

    expect(paramsOf(lamp, 'color_temp')).toBeNull();
  });
});

describe('isCommandable', () => {
  it('is true for a device that takes commands', () => {
    expect(isCommandable(anEntity())).toBe(true);
  });

  it('is false for what core would refuse', () => {
    expect(isCommandable(anEntity({ isEnabled: false }))).toBe(false);
    expect(isCommandable(anEntity({ source: 'system' }))).toBe(false);
    expect(isCommandable(anEntity({ source: 'derived' }))).toBe(false);
    expect(
      isCommandable(anEntity({ capabilities: [{ capability: 'sensor_numeric', params: {} }] })),
    ).toBe(false);
  });
});

describe('entityScopesOf', () => {
  it('names the entity, its area and every tag on it or on its device, as the API does', () => {
    const exterior = aTag('exterior');
    const energy = aTag('energy');
    const relay = anEntity({ areaKey: 'garage', tagIds: [exterior.id] });

    expect(entityScopesOf(relay, [exterior, energy], [energy.id, exterior.id])).toEqual([
      'entity.switch.garage_relay',
      'area.garage',
      'tag.exterior',
      'tag.energy',
    ]);
  });
});

describe('the commands and the colours', () => {
  it('switches explicitly, never by toggling', () => {
    expect(powerCommand(true)).toEqual({ command: 'turn_on' });
    expect(powerCommand(false)).toEqual({ command: 'turn_off' });
  });

  it('converts between mireds and kelvin', () => {
    expect(miredsToKelvin(500)).toBe(2000);
    expect(miredsToKelvin(111)).toBe(9010);
    expect(kelvinToMireds(2700)).toBe(370);
  });

  it('paints warm whites warm and cool whites cool', () => {
    expect(kelvinColor(2000)).toMatch(/^rgb\(255 1[0-9]{2} [0-9]{1,2}\)$/u);
    expect(kelvinColor(6600)).toBe('rgb(255 255 255)');
    expect(warmthGradient(2000, 6500)).toMatch(/^linear-gradient\(90deg, rgb\(255 .* 100%\)$/u);
  });

  it('fades a colour to white as its saturation falls', () => {
    expect(hsColor(120, 100)).toBe('hsl(120 100% 50%)');
    expect(hsColor(120, 0)).toBe('hsl(120 0% 100%)');
  });

  it('reads a picked colour as a hue and a saturation, its brightness left to the light', () => {
    expect(hexToHs('#ff0000')).toEqual({ hue: 0, saturation: 100 });
    expect(hexToHs('#800000')).toEqual({ hue: 0, saturation: 100 });
    expect(hexToHs('#80ff80')).toEqual({ hue: 120, saturation: 50 });
    expect(hexToHs('#00f')).toEqual({ hue: 240, saturation: 100 });
    expect(hexToHs('#ffffff')).toEqual({ hue: 0, saturation: 0 });
    expect(hexToHs('red')).toBeNull();
  });
});
