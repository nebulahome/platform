/**
 * Who may publish and subscribe where: topic filters, the way MQTT writes them.
 *
 * A principal is given the filters it may publish to and subscribe under - `#` for the hub,
 * `zigbee2mqtt/#` for Zigbee2MQTT's container, `<username>/#` and the discovery prefix for a
 * device - and every publish and subscription is held to them. A subscription is allowed only
 * when all it could match is within what the principal may read: `zigbee2mqtt/+/set` under
 * `zigbee2mqtt/#`, never `#` under it. `$SYS` is the broker's own and nobody writes there.
 */

/** Where one principal may publish, and what it may subscribe to. */
export type Access = {
  readonly publish: readonly string[];
  readonly subscribe: readonly string[];
};

/** Everything, save the broker's own topics. */
export const FULL_ACCESS: Access = { publish: ['#'], subscribe: ['#'] };

/**
 * Whether a topic is one a filter matches.
 *
 * @param filter - `a/+/c`, `a/#`.
 * @param topic - `a/b/c`.
 * @returns True when it matches.
 */
export function topicMatches(filter: string, topic: string): boolean {
  const filterLevels = filter.split('/');
  const topicLevels = topic.split('/');

  // A filter starting with a wildcard never matches a `$` topic (MQTT-4.7.2-1).
  if (topic.startsWith('$') && (filter.startsWith('+') || filter.startsWith('#'))) {
    return false;
  }

  for (let index = 0; index < filterLevels.length; index += 1) {
    const level = filterLevels[index];

    if (level === '#') {
      return true;
    }

    if (index >= topicLevels.length) {
      return false;
    }

    if (level !== '+' && level !== topicLevels[index]) {
      return false;
    }
  }

  return filterLevels.length === topicLevels.length;
}

/**
 * Whether everything a subscription could match is within what a filter allows.
 *
 * @param subscription - What the client asks for: `zigbee2mqtt/+/set`.
 * @param allowed - What it may read: `zigbee2mqtt/#`.
 * @returns True when the subscription asks for nothing outside it.
 */
export function filterWithin(subscription: string, allowed: string): boolean {
  const asked = subscription.split('/');
  const given = allowed.split('/');

  for (let index = 0; index < given.length; index += 1) {
    const level = given[index];

    if (level === '#') {
      return true;
    }

    const wanted = asked[index];

    if (wanted === undefined || wanted === '#') {
      return false;
    }

    if (level === '+') {
      continue;
    }

    if (wanted === '+' || wanted !== level) {
      return false;
    }
  }

  return asked.length === given.length;
}

/**
 * Whether a principal may publish to a topic.
 *
 * @param access - What it may do.
 * @param topic - Where it publishes.
 * @returns True when it may.
 */
export function mayPublish(access: Access, topic: string): boolean {
  return !topic.startsWith('$SYS') && access.publish.some((filter) => topicMatches(filter, topic));
}

/**
 * Whether a principal may subscribe to a filter.
 *
 * @param access - What it may do.
 * @param subscription - What it asks for.
 * @returns True when all of it is within what it may read.
 */
export function maySubscribe(access: Access, subscription: string): boolean {
  return access.subscribe.some((allowed) => filterWithin(subscription, allowed));
}

/**
 * What a device client may do: its own topics and the discovery prefix, or everything.
 *
 * @param username - Its username.
 * @param kind - `prefix` for `<username>/#` and the announcements, `all` for every topic.
 * @param discoveryPrefix - Where the announcements are: `homeassistant`.
 * @returns Its access.
 */
export function clientAccess(
  username: string,
  kind: 'prefix' | 'all',
  discoveryPrefix: string,
): Access {
  if (kind === 'all') {
    return FULL_ACCESS;
  }

  const own = [`${username}/#`, `${discoveryPrefix}/#`];

  return { publish: own, subscribe: own };
}
