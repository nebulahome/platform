import { describe, expect, it } from 'vitest';

import { readDashboardFile, summariseDashboardFile } from '@/dashboard/dashboard-file';

/** A dashboard file with one light and one scene. */
const FILE = {
  format: 'nebula-home/dashboard',
  version: 1,
  name: 'Home',
  icon: null,
  layout: {
    cards: [
      {
        id: 'lightaaaa',
        type: 'entity',
        x: 0,
        y: 0,
        w: 1,
        h: 2,
        entityId: 'light.kitchen_ceiling',
        title: null,
        icon: null,
        range: null,
      },
      {
        id: 'scene0001',
        type: 'scene',
        x: 1,
        y: 0,
        w: 1,
        h: 1,
        sceneId: '018f1c2e-4a5b-7c8d-9e0f-1a2b3c4d5e6f',
        title: null,
        icon: null,
      },
    ],
  },
};

describe('readDashboardFile', () => {
  it('reads a dashboard file', () => {
    const reading = readDashboardFile(JSON.stringify(FILE));

    expect(reading.ok && reading.document.name).toBe('Home');
  });

  it('says a file that is not JSON is not one', () => {
    expect(readDashboardFile('<svg/>')).toEqual({
      ok: false,
      problem: 'This file is not JSON, so it cannot be a dashboard.',
    });
  });

  it('says JSON of something else is not a dashboard', () => {
    expect(readDashboardFile('{"cards": []}')).toEqual({
      ok: false,
      problem: 'This file is not a Nebula Home dashboard.',
    });
  });

  it('names a file from a newer platform', () => {
    const reading = readDashboardFile(JSON.stringify({ ...FILE, version: 4 }));

    expect(reading).toEqual({
      ok: false,
      problem:
        'This dashboard file does not read: Made by a newer NebulaHome (format 4): update to import it.',
    });
  });
});

describe('summariseDashboardFile', () => {
  it('counts the cards, and what of them this house cannot show', () => {
    const reading = readDashboardFile(JSON.stringify(FILE));

    if (!reading.ok) {
      throw new Error(reading.problem);
    }

    expect(
      summariseDashboardFile(
        reading.document,
        () => false,
        () => true,
      ),
    ).toEqual({ cards: 2, missingEntities: 1, missingScenes: 0 });
  });
});
