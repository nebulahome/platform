import { describe, expect, it } from 'vitest';

import type { AliasScalar } from '@nebulahome/contracts';

import { buildHttpRequest, fillTemplate, type HttpRequestAction } from './http-request.js';

const readings: Readonly<Record<string, AliasScalar>> = {
  'sensor.grid_power': 1860,
  'sensor.lr_temperature': 21.4,
  'binary_sensor.front_door': false,
  'select.mode': 'away & back',
};

/**
 * Builds the request an action sends over the readings above.
 *
 * @param action - What differs from a plain POST.
 * @returns The request.
 */
function build(action: Partial<HttpRequestAction>) {
  return buildHttpRequest(
    {
      type: 'http_request',
      method: 'POST',
      url: 'https://hooks.example.com/house',
      variables: {
        power: 'sensor.grid_power',
        temp: 'sensor.lr_temperature',
        door: 'binary_sensor.front_door',
        mode: 'select.mode',
      },
      timeoutMs: 10_000,
      ...action,
    },
    (entityId) => readings[entityId],
    (secret) => `opened ${String(secret.$sealed)}`,
  );
}

describe('fillTemplate', () => {
  it('puts each reading where its name is, spaces inside the braces or not', () => {
    const values = new Map<string, AliasScalar>([['power', 1860]]);

    expect(fillTemplate('{{power}} and {{ power }}', values, String)).toBe('1860 and 1860');
  });

  it('refuses a name that is no parameter, rather than sending it as written', () => {
    expect(() => fillTemplate('{{ nope }}', new Map(), String)).toThrow(
      '{{ nope }} is not one of the parameters',
    );
  });
});

describe('buildHttpRequest', () => {
  it('encodes readings in the address', () => {
    const request = build({ url: 'https://api.example.com/v1/{{ mode }}?w={{ power }}' });

    expect(request.url.href).toBe('https://api.example.com/v1/away%20%26%20back?w=1860');
  });

  it('writes JSON literals into a JSON body, and says it is JSON', () => {
    const request = build({
      body: {
        kind: 'json',
        text: '{ "w": {{ power }}, "t": {{ temp }}, "door": {{ door }}, "mode": {{ mode }} }',
      },
    });

    expect(JSON.parse(request.body ?? '')).toEqual({
      w: 1860,
      t: 21.4,
      door: false,
      mode: 'away & back',
    });
    expect(request.headers['content-type']).toBe('application/json');
  });

  it('url-encodes a form body and leaves a text body as read', () => {
    expect(build({ body: { kind: 'form', text: 'mode={{ mode }}' } }).body).toBe(
      'mode=away%20%26%20back',
    );
    expect(build({ body: { kind: 'text', text: 'mode {{ mode }}' } }).body).toBe(
      'mode away & back',
    );
  });

  it("keeps the block's own content type, and sends no body with GET", () => {
    const typed = build({
      headers: [{ name: 'Content-Type', value: 'text/csv' }],
      body: { kind: 'text', text: 'a,b' },
    });

    expect(typed.headers).toEqual({ 'Content-Type': 'text/csv' });
    expect(build({ method: 'GET', body: { kind: 'json', text: '{}' } }).body).toBeUndefined();
  });

  it('opens a secret header, and fails on a parameter with no reading', () => {
    expect(
      build({ headers: [{ name: 'Authorization', value: { $sealed: 'v1:abc' } }] }).headers,
    ).toEqual({ Authorization: 'opened v1:abc' });
    expect(() =>
      build({ variables: { lux: 'sensor.lux' }, url: 'https://x.example/{{ lux }}' }),
    ).toThrow('lux (sensor.lux) has no reading');
  });

  it('refuses an address that a reading turned into something other than http', () => {
    expect(() => build({ url: 'https://{{ mode }}' })).toThrow();
  });
});
