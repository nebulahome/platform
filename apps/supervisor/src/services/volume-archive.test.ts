/**
 * Which named volumes a backup copies: a plain local one, and not one only a container's id
 * names, nor one its driver keeps on another machine.
 */
import { describe, expect, it } from 'vitest';

import type { InspectedVolume } from '../docker/engine-schemas.js';

import { skipReason } from './volume-archive.js';

/**
 * A volume, inspected.
 *
 * @param fields - What differs from a plain local volume.
 * @returns It.
 */
function volume(fields: Partial<InspectedVolume>): InspectedVolume {
  return { Name: 'web_data', Driver: 'local', Labels: {}, Options: {}, ...fields };
}

describe('skipReason', () => {
  it('copies a plain local volume', () => {
    expect(skipReason(volume({}))).toBe(null);
  });

  it('leaves out an anonymous one', () => {
    expect(skipReason(volume({ Labels: { 'com.docker.volume.anonymous': '' } }))).not.toBe(null);
    expect(skipReason(volume({ Name: 'a'.repeat(64) }))).not.toBe(null);
  });

  it('leaves out one its driver keeps elsewhere', () => {
    expect(skipReason(volume({ Options: { type: 'nfs', device: ':/export' } }))).not.toBe(null);
    expect(skipReason(volume({ Driver: 'rclone' }))).not.toBe(null);
  });
});
