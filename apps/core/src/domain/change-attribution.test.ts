import { describe, expect, it } from 'vitest';

import { parseEntityId } from '@nebulahome/contracts';

import { ChangeAttribution } from './change-attribution.js';

const lamp = parseEntityId('light.porch');
const run = { type: 'automation', id: '00000000-0000-4000-8000-000000000001' } as const;
const person = { type: 'user', id: '00000000-0000-4000-8000-000000000002' } as const;

describe('ChangeAttribution', () => {
  it('credits every change inside the window to the command, not only the first', () => {
    let now = 0;
    const attribution = new ChangeAttribution(() => now, 5_000);

    attribution.note(lamp, run);
    now = 1_000;
    expect(attribution.of(lamp)).toEqual(run);
    now = 4_000;
    // A fade reports again; still the same command's doing.
    expect(attribution.of(lamp)).toEqual(run);
  });

  it('credits nobody once the window has passed', () => {
    let now = 0;
    const attribution = new ChangeAttribution(() => now, 5_000);

    attribution.note(lamp, run);
    now = 5_001;
    expect(attribution.of(lamp)).toBeUndefined();
  });

  it('lets a newer command replace an older one', () => {
    const attribution = new ChangeAttribution(() => 0, 5_000);

    attribution.note(lamp, run);
    attribution.note(lamp, person);
    expect(attribution.of(lamp)).toEqual(person);
  });

  it('knows nothing of an entity nobody commanded', () => {
    expect(new ChangeAttribution().of(lamp)).toBeUndefined();
  });

  it('forgets expired causes when the map grows, so silent devices cannot fill it', () => {
    let now = 0;
    const attribution = new ChangeAttribution(() => now, 10);

    for (let index = 0; index < 1_001; index += 1) {
      attribution.note(parseEntityId(`light.lamp_${String(index)}`), run);
    }

    now = 100;
    attribution.note(lamp, run);
    expect(attribution.of(parseEntityId('light.lamp_0'))).toBeUndefined();
    expect(attribution.of(lamp)).toEqual(run);
  });
});
