import { describe, expect, it } from 'vitest';

import { openSecret, sealSecret, type Database } from '@nebulahome/db';

import { maskSecrets, sealSecrets } from './automation-secrets.js';

const KEY = Buffer.alloc(32, 7);

/**
 * An HTTP request action with an Authorization header.
 *
 * @param value - The header's value.
 * @returns The action.
 */
function request(value: unknown) {
  return {
    type: 'http_request',
    method: 'POST',
    url: 'https://hooks.example.com',
    headers: [
      { name: 'Content-Type', value: 'application/json' },
      { name: 'Authorization', value },
    ],
    timeoutMs: 10_000,
  };
}

/**
 * A database holding one automation's document.
 *
 * @param definition - The document.
 * @returns What the service reads it through.
 */
function holding(definition: unknown): Database {
  return {
    select: () => ({ from: () => Promise.resolve([{ definition }]) }),
  } as unknown as Database;
}

describe('the secret header of an HTTP request', () => {
  it('is sealed when typed, and nothing else is', async () => {
    const sealed = await sealSecrets(holding({}), { then: [request('Bearer abc')] }, KEY);
    const [action] = sealed.then;
    const authorization = action?.headers[1]?.value as { $sealed: string };

    expect(action?.headers[0]?.value).toBe('application/json');
    expect(openSecret(authorization, KEY)).toBe('Bearer abc');
  });

  it('leaves masked, and keeps the stored value when the mask comes back', async () => {
    const stored = { then: [request(sealSecret('Bearer abc', KEY))] };
    const masked = maskSecrets(stored);
    const back = await sealSecrets(holding(stored), masked, KEY);

    expect(JSON.stringify(masked)).not.toContain('v1:');
    expect(masked.then[0]?.headers[1]?.value).toMatchObject({ $sealed: true });
    expect(back).toEqual(stored);
  });

  it('refuses a sealed value sent as it is, or a mask of one the house does not hold', async () => {
    const foreign = sealSecret('the broker password', KEY);

    await expect(sealSecrets(holding({}), { then: [request(foreign)] }, KEY)).rejects.toThrow(
      'type its value again',
    );
    await expect(sealSecrets(holding({}), { params: { stolen: foreign } }, KEY)).rejects.toThrow();
    await expect(
      sealSecrets(holding({}), maskSecrets({ then: [request(foreign)] }), KEY),
    ).rejects.toThrow();
  });
});
