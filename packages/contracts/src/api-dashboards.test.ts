import { describe, expect, it } from 'vitest';

import {
  DASHBOARD_CARDS_MAXIMUM,
  dashboardCreateSchema,
  dashboardDocumentSchema,
  dashboardFileName,
  dashboardLayoutSchema,
  dashboardUpdateSchema,
  toDashboardDocument,
} from './api-dashboards.js';

/**
 * A light card, for tests that vary where it sits.
 *
 * @param id - Its identifier.
 * @param x - Its column.
 * @param y - Its row.
 * @param w - How many columns it spans.
 * @param h - How many rows it spans.
 * @returns The card.
 */
function light(id: string, x: number, y: number, w = 1, h = 2): Record<string, unknown> {
  return {
    id,
    type: 'entity',
    x,
    y,
    w,
    h,
    entityId: 'light.kitchen_ceiling',
    title: null,
    icon: null,
    range: null,
  };
}

/**
 * A container holding the given cards.
 *
 * @param cards - What it holds.
 * @param w - How many columns it spans.
 * @param h - How many rows it spans, heading included.
 * @returns The card.
 */
function box(cards: Record<string, unknown>[], w = 4, h = 3): Record<string, unknown> {
  return {
    id: 'container01',
    type: 'container',
    x: 0,
    y: 0,
    w,
    h,
    title: 'Ground floor',
    icon: 'house',
    cards,
  };
}

/**
 * The messages a layout is refused with.
 *
 * @param layout - The candidate document.
 * @returns Every issue's message, or an empty list when it is accepted.
 */
function problems(layout: unknown): string[] {
  const result = dashboardLayoutSchema.safeParse(layout);

  return result.success ? [] : result.error.issues.map((issue) => issue.message);
}

describe('dashboardLayoutSchema', () => {
  it('accepts cards side by side and a container holding its own', () => {
    const layout = {
      cards: [
        light('lightaaaa', 0, 0),
        light('lightbbbb', 1, 0, 2, 2),
        {
          id: 'clock0001',
          type: 'clock',
          x: 3,
          y: 0,
          w: 1,
          h: 1,
          showSeconds: false,
          showDate: true,
        },
        { ...box([light('lightcccc', 0, 0), light('lightdddd', 1, 0)]), y: 2 },
      ],
    };

    expect(problems(layout)).toEqual([]);
  });

  it('refuses a card that runs past the fourth column', () => {
    expect(problems({ cards: [light('lightaaaa', 3, 0, 2, 2)] })).toEqual([
      'Card lightaaaa runs past the 4 columns it sits in',
    ]);
  });

  it('refuses two cards on the same cell', () => {
    expect(problems({ cards: [light('lightaaaa', 0, 0), light('lightbbbb', 0, 1)] })).toEqual([
      'Cards lightaaaa and lightbbbb cover the same cells',
    ]);
  });

  it('measures a container by its own width, not the page', () => {
    // Two columns wide, so a card at its second column already fills it.
    const layout = { cards: [box([light('lightaaaa', 1, 0, 2, 2)], 2)] };

    expect(problems(layout)).toEqual(['Card lightaaaa runs past the 2 columns it sits in']);
  });

  it('refuses a container shorter than what it holds, heading row included', () => {
    const layout = { cards: [box([light('lightaaaa', 0, 0, 1, 2)], 4, 2)] };

    expect(problems(layout)).toEqual(['Container container01 is shorter than the cards it holds']);
  });

  it('refuses a container inside a container', () => {
    const layout = { cards: [box([{ ...box([]), id: 'container02' }], 4, 4)] };

    expect(problems(layout).length).toBeGreaterThan(0);
  });

  it('refuses the same id twice, even across a container', () => {
    const layout = {
      cards: [light('lightaaaa', 0, 0), { ...box([light('lightaaaa', 0, 0)]), y: 2 }],
    };

    expect(problems(layout)).toEqual(['Card id lightaaaa is used twice']);
  });

  it('counts the cards inside containers towards the limit', () => {
    const inside = [...Array.from({ length: DASHBOARD_CARDS_MAXIMUM }).keys()].map((index) =>
      light(`card${String(index).padStart(4, '0')}`, index % 4, Math.floor(index / 4) * 2),
    );
    const layout = { cards: [box(inside, 4, 101)] };

    expect(problems(layout)).toContain('A dashboard holds at most 200 cards');
  });

  it('refuses an entity card without a well-formed address', () => {
    expect(
      problems({ cards: [{ ...light('lightaaaa', 0, 0), entityId: 'Kitchen' }] }),
    ).toHaveLength(1);
  });
});

describe('dashboardCreateSchema', () => {
  it('needs only a name', () => {
    expect(dashboardCreateSchema.parse({ name: '  Home ' })).toEqual({ name: 'Home' });
  });

  it('refuses a blank name', () => {
    expect(dashboardCreateSchema.safeParse({ name: '   ' }).success).toBe(false);
  });
});

describe('dashboardUpdateSchema', () => {
  it('refuses a change that changes nothing', () => {
    expect(dashboardUpdateSchema.safeParse({}).success).toBe(false);
  });

  it('takes a whole layout', () => {
    const body = dashboardUpdateSchema.parse({ layout: { cards: [light('lightaaaa', 0, 0)] } });

    expect(body.layout?.cards).toHaveLength(1);
  });
});

describe('the dashboard file', () => {
  const dashboard = {
    id: '018f1c2e-4a5b-7c8d-9e0f-1a2b3c4d5e6f',
    name: 'Home',
    icon: 'house',
    layout: { cards: [] },
    layoutVersion: 1,
    createdAt: new Date('2026-09-24T08:00:00.000Z'),
    updatedAt: new Date('2026-09-24T09:00:00.000Z'),
  };

  it('keeps only what means the same in another house', () => {
    const document = toDashboardDocument(dashboard);

    expect(document).toEqual({
      format: 'nebula-home/dashboard',
      version: 1,
      name: 'Home',
      icon: 'house',
      layout: { cards: [] },
    });
    expect(dashboardDocumentSchema.parse(JSON.parse(JSON.stringify(document)))).toEqual(document);
  });

  it('refuses JSON that is not a dashboard file', () => {
    const result = dashboardDocumentSchema.safeParse({
      ...toDashboardDocument(dashboard),
      format: 'scene',
    });

    expect(result.success).toBe(false);
  });

  it('names a file from a newer platform as such', () => {
    const result = dashboardDocumentSchema.safeParse({
      ...toDashboardDocument(dashboard),
      version: 7,
    });

    expect(result.success ? [] : result.error.issues.map((issue) => issue.message)).toEqual([
      'Made by a newer NebulaHome (format 7): update to import it',
    ]);
  });

  it('is named after the dashboard, accents folded', () => {
    expect(dashboardFileName('Soggiorno è  Cucina!')).toBe('soggiorno-e-cucina.dashboard.json');
    expect(dashboardFileName('★★★')).toBe('dashboard.dashboard.json');
  });
});
