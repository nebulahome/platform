import { describe, expect, it } from 'vitest';

import type { AutomationTrigger } from '@nebulahome/contracts';

import { CallCounter, decideWebhook, webhookTargets } from './webhook.js';

const HOOK = '7f3a9c2e5b1d4e88a0b1c2d3e4f50617';

/**
 * A webhook trigger with the id above.
 *
 * @param more - What differs from a local POST.
 * @returns The trigger.
 */
function webhook(more: Partial<Extract<AutomationTrigger, { type: 'webhook' }>> = {}) {
  return { type: 'webhook', hookId: HOOK, method: 'POST', reach: 'local', ...more } as const;
}

/**
 * Decides a call to the automations given.
 *
 * @param triggers - Each automation's triggers.
 * @param call - The call.
 * @param call.method - Its method.
 * @param call.isLocal - Whether it came from the house's network.
 * @param allowInternet - The setting.
 * @param admit - The limit.
 * @returns The decision.
 */
function decide(
  triggers: readonly AutomationTrigger[][],
  call: { method: string; isLocal: boolean },
  allowInternet = true,
  admit = true,
) {
  const automations = triggers.map((list, index) => ({ id: `a${String(index)}`, triggers: list }));

  return decideWebhook(webhookTargets(automations, HOOK), call, allowInternet, () => admit);
}

describe('decideWebhook', () => {
  const local = { method: 'POST', isLocal: true };
  const outside = { method: 'POST', isLocal: false };

  it('says 404 to an id no trigger has, or only one turned off', () => {
    expect(decide([[{ type: 'manual' }]], local)).toMatchObject({
      status: 404,
      outcome: 'not_found',
    });
    expect(decide([[webhook({ isEnabled: false })]], local)).toMatchObject({ status: 404 });
  });

  it('says 404 from outside to a local webhook, and to any while the internet is off', () => {
    expect(decide([[webhook()]], outside)).toMatchObject({
      status: 404,
      outcome: 'local_only',
      automationId: 'a0',
    });
    expect(decide([[webhook({ reach: 'internet' })]], outside, false)).toMatchObject({
      status: 404,
    });
    expect(decide([[webhook({ reach: 'internet' })]], outside)).toMatchObject({ status: 200 });
  });

  it('says 405 to a method it does not take, before counting the call', () => {
    expect(decide([[webhook()]], { method: 'GET', isLocal: true }, true, false)).toMatchObject({
      status: 405,
      outcome: 'wrong_method',
    });
    expect(decide([[webhook({ method: 'any' })]], { method: 'GET', isLocal: true })).toMatchObject({
      status: 200,
    });
  });

  it('says 429 over the limit, and otherwise wakes every automation with the id', () => {
    expect(decide([[webhook()]], local, true, false)).toMatchObject({
      status: 429,
      outcome: 'rate_limited',
    });
    expect(decide([[{ type: 'manual' }, webhook()], [webhook()]], local)).toEqual({
      status: 200,
      targets: [
        { automationId: 'a0', path: 'triggers.1', trigger: webhook() },
        { automationId: 'a1', path: 'triggers.0', trigger: webhook() },
      ],
    });
  });
});

describe('CallCounter', () => {
  it('takes the limit a minute per webhook, then starts counting again', () => {
    const counter = new CallCounter();
    const calls = [0, 1_000, 2_000].map((at) => counter.admit(HOOK, at, 2));

    expect(calls).toEqual([true, true, false]);
    expect(counter.admit('other', 2_000, 2)).toBe(true);
    expect(counter.admit(HOOK, 60_000, 2)).toBe(true);
  });
});
