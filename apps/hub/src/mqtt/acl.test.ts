/**
 * Who may publish and subscribe where, without a broker.
 */
import { describe, expect, it } from 'vitest';

import { clientAccess, filterWithin, mayPublish, maySubscribe, topicMatches } from './acl.js';

describe('topic filters', () => {
  it('match as MQTT says', () => {
    expect(topicMatches('a/+/c', 'a/b/c')).toBe(true);
    expect(topicMatches('a/#', 'a')).toBe(true);
    expect(topicMatches('a/#', 'a/b/c')).toBe(true);
    expect(topicMatches('a/+', 'a/b/c')).toBe(false);
    expect(topicMatches('#', '$SYS/broker')).toBe(false);
  });

  it('hold a subscription to what it may read, wildcards included', () => {
    expect(filterWithin('zigbee2mqtt/+/set', 'zigbee2mqtt/#')).toBe(true);
    expect(filterWithin('zigbee2mqtt/#', 'zigbee2mqtt/#')).toBe(true);
    expect(filterWithin('#', 'zigbee2mqtt/#')).toBe(false);
    expect(filterWithin('+/bridge', 'zigbee2mqtt/#')).toBe(false);
    expect(filterWithin('a/b', 'a/+')).toBe(true);
    expect(filterWithin('a/+', 'a/b')).toBe(false);
  });

  it("give a device its own topics and the announcements, and nobody the broker's", () => {
    const access = clientAccess('shelly-plug', 'prefix', 'homeassistant');

    expect(mayPublish(access, 'shelly-plug/relay/0')).toBe(true);
    expect(mayPublish(access, 'homeassistant/switch/plug/config')).toBe(true);
    expect(mayPublish(access, 'zigbee2mqtt/bridge/request/permit_join')).toBe(false);
    expect(maySubscribe(access, 'shelly-plug/#')).toBe(true);
    expect(maySubscribe(access, '#')).toBe(false);
    expect(mayPublish(clientAccess('x', 'all', 'homeassistant'), '$SYS/broker/uptime')).toBe(false);
  });
});
