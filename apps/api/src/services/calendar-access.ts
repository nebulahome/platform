/**
 * Who may change what in the calendars (plan §6.2).
 *
 * Everyone who reads calendars sees all of them; the rights only decide who changes them.
 * - `calendar:manage` (the owner and admins) changes everything: every calendar's events, its
 *   settings, its editors, the holidays and the share links.
 * - A calendar's editors (its Editors list) add, move and delete its events.
 * - The owner of a personal calendar edits its events and its settings, its editors included.
 * - Holidays is a house setting: only `calendar:manage` adds a holiday by hand or hides one.
 * - Events that came from an ICS source or from an entity are never edited by anyone: they change
 *   at their source.
 */
import { PermissionError, type CalendarKind, type Identity } from '@nebulahome/contracts';

import { isPermitted } from '../auth/permissions.js';

/** What the rights need of a calendar. */
export type CalendarRights = {
  readonly kind: CalendarKind;
  readonly ownerUserId: string | null;
  readonly editorIds: readonly string[];
};

/**
 * Whether someone manages the calendars.
 *
 * @param identity - Who is asking.
 * @returns True for `calendar:manage`.
 */
export function managesCalendars(identity: Identity): boolean {
  return isPermitted(identity.permissions, 'calendar:manage');
}

/**
 * Whether someone may add, move and delete a calendar's events.
 *
 * @param identity - Who is asking.
 * @param calendar - The calendar.
 * @returns True when they may.
 */
export function canEditCalendar(identity: Identity, calendar: CalendarRights): boolean {
  if (managesCalendars(identity)) {
    return true;
  }

  if (calendar.kind === 'holidays') {
    return false;
  }

  return calendar.ownerUserId === identity.userId || calendar.editorIds.includes(identity.userId);
}

/**
 * Whether someone may change a calendar itself: name, colour, Day off, its source, its editors.
 *
 * @param identity - Who is asking.
 * @param calendar - The calendar.
 * @returns True for `calendar:manage`, and for the owner of a personal calendar.
 */
export function canChangeCalendar(identity: Identity, calendar: CalendarRights): boolean {
  return (
    managesCalendars(identity) ||
    (calendar.kind === 'personal' && calendar.ownerUserId === identity.userId)
  );
}

/**
 * Whether someone may change one event.
 *
 * @param identity - Who is asking.
 * @param calendar - The event's calendar.
 * @param source - Where the event came from.
 * @returns True for an event typed in the calendar, by someone who edits it.
 */
export function canEditEvent(
  identity: Identity,
  calendar: CalendarRights,
  source: 'user' | 'ics',
): boolean {
  return source === 'user' && canEditCalendar(identity, calendar);
}

/**
 * Fails when someone may not edit a calendar's events.
 *
 * @param identity - Who is asking.
 * @param calendar - The calendar.
 * @throws {PermissionError} When they may not.
 */
export function requireCanEditCalendar(identity: Identity, calendar: CalendarRights): void {
  if (!canEditCalendar(identity, calendar)) {
    throw new PermissionError('You are not one of the editors of this calendar', {
      details: { permission: 'calendar:manage' },
    });
  }
}

/**
 * Fails when someone may not change a calendar itself.
 *
 * @param identity - Who is asking.
 * @param calendar - The calendar.
 * @throws {PermissionError} When they may not.
 */
export function requireCanChangeCalendar(identity: Identity, calendar: CalendarRights): void {
  if (!canChangeCalendar(identity, calendar)) {
    throw new PermissionError('This action requires calendar:manage', {
      details: { permission: 'calendar:manage' },
    });
  }
}
