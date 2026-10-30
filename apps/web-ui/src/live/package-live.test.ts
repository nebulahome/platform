/**
 * The packages' live topics of a tab: one follow per topic, followed again on every new socket,
 * and the last message kept for whoever draws it.
 */
import { describe, expect, it } from 'vitest';

import type { WsClientMessage } from '@nebulahome/contracts';

import { PackageLive } from './package-live';

describe('PackageLive', () => {
  it('follows a topic once however many listen, and leaves it with the last', () => {
    const live = new PackageLive();
    const sent: WsClientMessage[] = [];
    let heard = 0;

    live.attach((message) => {
      sent.push(message);
    });

    const first = live.follow('music', 'overview', () => {
      heard += 1;
    });
    const second = live.follow('music', 'overview', () => {
      heard += 1;
    });

    live.apply({ type: 'package_message', packageId: 'music', topic: 'overview', data: [1] });
    live.apply({ type: 'package_message', packageId: 'music', topic: 'queue', data: [2] });

    expect(heard).toBe(2);
    expect(live.read('music', 'overview')).toEqual([1]);
    expect(live.read('music', 'queue')).toBeUndefined();

    first();
    second();

    expect(sent).toEqual([
      { type: 'package_subscribe', packageId: 'music', topic: 'overview' },
      { type: 'package_unsubscribe', packageId: 'music', topic: 'overview' },
    ]);
    expect(live.read('music', 'overview')).toBeUndefined();
  });

  it('follows every topic again on a new socket, and keeps what it heard meanwhile', () => {
    const live = new PackageLive();
    const sent: WsClientMessage[] = [];

    live.follow('music', 'browser.ab12', () => undefined);
    live.apply({ type: 'package_message', packageId: 'music', topic: 'browser.ab12', data: 1 });
    live.send('music', 'browser', { playback: 'paused' });
    live.attach((message) => {
      sent.push(message);
    });
    live.send('music', 'browser', { playback: 'paused' });
    live.detach();
    live.send('music', 'browser', { playback: 'playing' });

    expect(sent).toEqual([
      { type: 'package_subscribe', packageId: 'music', topic: 'browser.ab12' },
      { type: 'package_send', packageId: 'music', topic: 'browser', data: { playback: 'paused' } },
    ]);
    expect(live.read('music', 'browser.ab12')).toBe(1);
  });
});
