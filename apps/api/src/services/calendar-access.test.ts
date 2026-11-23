import { describe, expect, it } from 'vitest';

import type { Identity } from '@nebulahome/contracts';

import {
  canChangeCalendar,
  canEditCalendar,
  canEditEvent,
  type CalendarRights,
} from './calendar-access.js';

/**
 * Someone holding some permissions.
 *
 * @param userId - Who.
 * @param keys - The permissions, everywhere.
 * @returns The identity.
 */
function person(userId: string, keys: string[]): Identity {
  return {
    userId,
    permissions: keys.map((key) => ({ key, scope: '*', effect: 'allow' as const })),
  } as unknown as Identity;
}

const owner = person('bobby', ['calendar:read', 'calendar:manage']);
const giulia = person('giulia', ['calendar:read']);
const elena = person('elena', ['calendar:read']);
const house: CalendarRights = { kind: 'house', ownerUserId: null, editorIds: ['giulia'] };
const holidays: CalendarRights = { kind: 'holidays', ownerUserId: null, editorIds: ['giulia'] };
const giuliasOwn: CalendarRights = { kind: 'personal', ownerUserId: 'giulia', editorIds: [] };

describe('calendar rights', () => {
  it('lets the owner do everything', () => {
    expect(canEditCalendar(owner, house)).toBe(true);
    expect(canEditCalendar(owner, holidays)).toBe(true);
    expect(canChangeCalendar(owner, giuliasOwn)).toBe(true);
  });

  it('lets editors edit events but not the calendar itself', () => {
    expect(canEditCalendar(giulia, house)).toBe(true);
    expect(canChangeCalendar(giulia, house)).toBe(false);
    expect(canEditCalendar(elena, house)).toBe(false);
  });

  it('keeps holidays to who manages, whatever the list says', () => {
    expect(canEditCalendar(giulia, holidays)).toBe(false);
  });

  it('lets a personal calendar’s owner change it and pick its editors', () => {
    expect(canEditCalendar(giulia, giuliasOwn)).toBe(true);
    expect(canChangeCalendar(giulia, giuliasOwn)).toBe(true);
    expect(canChangeCalendar(elena, giuliasOwn)).toBe(false);
  });

  it('never lets anyone edit an event that came from a source', () => {
    expect(canEditEvent(owner, house, 'ics')).toBe(false);
    expect(canEditEvent(giulia, house, 'user')).toBe(true);
  });
});
