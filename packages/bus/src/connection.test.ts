/**
 * The broker's URL, split into where it is and who connects: a password in the URL is handed to
 * the client as an option and never stays in the address that is logged.
 */
import { describe, expect, it } from 'vitest';

import { brokerAddressOf } from './connection.js';

describe('brokerAddressOf', () => {
  it('leaves a URL without credentials as it is', () => {
    expect(brokerAddressOf('nats://localhost:4222')).toEqual({ server: 'nats://localhost:4222' });
  });

  it('takes the user and the password out of the URL', () => {
    expect(brokerAddressOf('nats://nebula:s%40cret@127.0.0.1:4223')).toEqual({
      server: 'nats://127.0.0.1:4223',
      user: 'nebula',
      pass: 's@cret',
    });
  });
});
