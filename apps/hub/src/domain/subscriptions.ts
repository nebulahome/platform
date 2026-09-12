/**
 * What one shared connection has to carry, once every instance on it has been asked.
 *
 * Connections are shared - two integrations configured against the same MQTT broker get one
 * session - so the transport is told the whole set at once rather than one instance at a time.
 * That is what makes {@link TransportConnection.apply} a replacement rather than an addition: an
 * instance stopping means recomputing the set without it and applying that, so the transport
 * never has to work out what to undo.
 *
 * Duplicates collapse. Two integrations watching one topic filter must not make the broker
 * deliver every message twice, and must not make one of them unsubscribing cut off the other.
 */
import type { TransportSubscription } from '@nebula-home/package-runtime';

/**
 * Merges what every instance on one connection asks for.
 *
 * @param asked - One entry per instance: what that instance wants carried.
 * @returns The set to apply, with duplicates collapsed and order preserved.
 */
export function planSubscriptions(
  asked: readonly (readonly TransportSubscription[])[],
): TransportSubscription[] {
  const unique = new Map<string, TransportSubscription>();

  for (const subscriptions of asked) {
    for (const subscription of subscriptions) {
      // Keyed by the whole thing rather than by `op`: a poll of one path every five seconds and
      // a poll of the same path every thirty are two different standing requests.
      unique.set(JSON.stringify(subscription), subscription);
    }
  }

  return [...unique.values()];
}
