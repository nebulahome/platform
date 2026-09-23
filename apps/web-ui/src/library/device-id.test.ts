import { describe, expect, it } from 'vitest';

import { suggestDeviceId } from './device-id';

describe('suggestDeviceId', () => {
  it('reads as the vendor and the name, in lower case with dashes', () => {
    expect(suggestDeviceId('bambu-lab', 'Studio printer', [])).toBe('bambu-lab-studio-printer');
    expect(suggestDeviceId('shelly', '1PM Mini Gen3', [])).toBe('shelly-1pm-mini-gen3');
  });

  it('counts on from the second device of the same name', () => {
    expect(suggestDeviceId('bambu-lab', 'X1C', ['bambu-lab-x1c'])).toBe('bambu-lab-x1c-2');
    expect(suggestDeviceId('bambu-lab', 'X1C', ['bambu-lab-x1c', 'bambu-lab-x1c-2'])).toBe(
      'bambu-lab-x1c-3',
    );
  });

  it('falls back on the vendor when the name has nothing an id can hold', () => {
    expect(suggestDeviceId('shelly', '···', [])).toBe('shelly');
  });
});
