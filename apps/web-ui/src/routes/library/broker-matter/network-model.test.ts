import { describe, expect, it } from 'vitest';

import type { MatterNetwork } from '@nebulahome/contracts';

import { rowsOf } from '@/routes/library/broker-matter/matter-rows';
import {
  MATTER_SAMPLE_DEVICES,
  MATTER_SAMPLE_NETWORK,
  MATTER_SAMPLE_NODES,
} from '@/testing/matter-samples';

import { CONTROLLER_ID, networkMapOf, type NetworkMap } from './network-model';

const ROWS = rowsOf(MATTER_SAMPLE_NODES, MATTER_SAMPLE_DEVICES, 'bridge');

/**
 * Each point by what it hangs on, as `parent > point (look)`.
 *
 * @param map - The map.
 * @returns The tree's links, sorted.
 */
function treeOf(map: NetworkMap): string[] {
  return map.links.map((link) => `${link.source} > ${link.target} (${link.look})`).sort();
}

describe('networkMapOf', () => {
  it('hangs routers on the house, devices on their router and a bridge’s behind it', () => {
    const map = networkMapOf(MATTER_SAMPLE_NETWORK, ROWS);

    expect(treeOf(map)).toEqual([
      '0x2A > 0x4C (offline)',
      '0x3B > 0x3B:1 (bridge)',
      '0x3B > 0x3B:2 (bridge)',
      'ap_3810D5A1B2C3 > 0x1F (wifi)',
      'ap_3810D5A1B2C3 > 0x3B (wifi)',
      'controller > ap_3810D5A1B2C3 (controller)',
      'controller > unknown_8E2F11A04C7D9B21 (controller)',
      'unknown_8E2F11A04C7D9B21 > 0x2A (thread)',
    ]);
    expect(map.counts).toEqual({ wifi: 2, thread: 2 });

    const byId = new Map(map.points.map((point) => [point.id, point]));

    expect(byId.get('ap_3810D5A1B2C3')).toMatchObject({
      kind: 'access-point',
      through: 4,
      ssid: 'Casa',
      channel: 6,
    });
    expect(byId.get('unknown_8E2F11A04C7D9B21')).toMatchObject({
      kind: 'thread-router',
      through: 2,
      networkName: 'Casa',
      channel: 15,
    });
    expect(byId.get('0x3B:1')).toMatchObject({ isBehindBridge: true, kind: 'device' });
    expect(byId.get('0x3B:1')?.row?.name).toBe('Sofa lamp');
    expect(byId.get(CONTROLLER_ID)).toMatchObject({ x: 0, y: 0, through: 6 });

    // Laid out away from the middle: a device sits further out than what it hangs on.
    const distance = (id: string): number => {
      const point = byId.get(id);

      return Math.hypot(point?.x ?? 0, point?.y ?? 0);
    };

    expect(distance('0x4C')).toBeGreaterThan(distance('0x2A'));
    expect(distance('0x2A')).toBeGreaterThan(distance('unknown_8E2F11A04C7D9B21'));
  });

  it('shows one network alone', () => {
    const map = networkMapOf(MATTER_SAMPLE_NETWORK, ROWS, 'thread');

    expect(map.points.map((point) => point.id)).toEqual([
      CONTROLLER_ID,
      'unknown_8E2F11A04C7D9B21',
      '0x2A',
      '0x4C',
    ]);
  });

  it('hangs a mesh no outside router was heard on by its leader, and a lone node on the house', () => {
    const network: MatterNetwork = {
      collectedAt: null,
      nodes: MATTER_SAMPLE_NETWORK.nodes
        .filter((point) => point.kind === 'matter')
        .map((point) =>
          point.id === '0x4C' ? { ...point, role: 'leader', isAvailable: true } : point,
        ),
      links: MATTER_SAMPLE_NETWORK.links.filter((link) => link.network === 'thread'),
    };

    expect(treeOf(networkMapOf(network, ROWS))).toEqual([
      '0x3B > 0x3B:1 (bridge)',
      '0x3B > 0x3B:2 (bridge)',
      '0x4C > 0x2A (thread)',
      'controller > 0x1F (controller)',
      'controller > 0x3B (controller)',
      'controller > 0x4C (controller)',
    ]);
  });
});
