/**
 * The words a failed probe uses, which are the words an owner reads under the Test button.
 *
 * The sessions themselves are tried against a broker in `tests/integration/mqtt.test.ts`; this is
 * the one pure step in between - the client's error becoming a sentence.
 */
import { ErrorWithReasonCode } from 'mqtt';
import { describe, expect, it } from 'vitest';

import { failureOf } from './mqtt.js';

const URL = 'mqtts://192.168.1.60:8883';

describe('failureOf', () => {
  it('says the broker refused when it answered the connect packet with a refusal', () => {
    const error = new ErrorWithReasonCode('Connection refused: Not authorized', 5);

    expect(failureOf(URL, error)).toBe(`${URL} refused the session: Not authorized`);
  });

  it('says the broker did not answer for a socket error, by its message', () => {
    expect(failureOf(URL, new Error('self-signed certificate'))).toBe(
      `${URL} did not answer: self-signed certificate`,
    );
  });

  it('falls back to the code when the error carries no message', () => {
    const error = Object.assign(new AggregateError([], ''), { code: 'ECONNREFUSED' });

    expect(failureOf(URL, error)).toBe(`${URL} did not answer: ECONNREFUSED`);
  });
});
