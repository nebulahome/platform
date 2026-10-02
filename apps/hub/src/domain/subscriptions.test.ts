import { describe, expect, it } from 'vitest';

import type { TransportSubscription } from '@nebulahome/package-runtime';

import { planSubscriptions } from './subscriptions.js';

/**
 * One instance's contribution to a connection.
 *
 * @param subscriptions - What it asks the transport to carry.
 * @returns The contribution.
 */
function asks(...subscriptions: TransportSubscription[]): TransportSubscription[] {
  return subscriptions;
}

describe('planSubscriptions', () => {
  it('carries what a single instance asks for', () => {
    const plan = planSubscriptions([asks({ op: 'poll', args: { path: '/status' } })]);

    expect(plan).toEqual([{ op: 'poll', args: { path: '/status' } }]);
  });

  it('merges what two instances on one connection ask for', () => {
    const plan = planSubscriptions([
      asks({ op: 'topic', args: { filter: 'zigbee2mqtt/#' } }),
      asks({ op: 'topic', args: { filter: 'tasmota/#' } }),
    ]);

    expect(plan).toHaveLength(2);
  });

  it('collapses two instances asking for exactly the same thing', () => {
    // Two integrations watching one MQTT topic filter must not make the broker deliver every
    // message twice, and must not make an unsubscribe from one silently cut off the other.
    const plan = planSubscriptions([
      asks({ op: 'topic', args: { filter: 'zigbee2mqtt/#' } }),
      asks({ op: 'topic', args: { filter: 'zigbee2mqtt/#' } }),
    ]);

    expect(plan).toEqual([{ op: 'topic', args: { filter: 'zigbee2mqtt/#' } }]);
  });

  it('treats a different argument as a different subscription', () => {
    const plan = planSubscriptions([
      asks({ op: 'poll', args: { path: '/status', everyMs: 5000 } }),
      asks({ op: 'poll', args: { path: '/status', everyMs: 30_000 } }),
    ]);

    expect(plan).toHaveLength(2);
  });

  it('is unbothered by an instance that asks for nothing', () => {
    // An instance with no devices adopted yet contributes nothing, which is different from
    // contributing an empty subscription.
    expect(planSubscriptions([asks(), asks({ op: 'poll', args: {} })])).toHaveLength(1);
  });

  it('produces nothing when nobody is on the connection', () => {
    // What is applied when the last instance on a connection stops: an empty set, which tells
    // the transport to carry nothing rather than leaving its old subscriptions in place.
    expect(planSubscriptions([])).toEqual([]);
  });
});
