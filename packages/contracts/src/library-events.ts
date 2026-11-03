/**
 * That part of the library changed: what a page lists that only an owner's edit changes.
 *
 * Devices, readings, runs and the rest have events of their own, told as they happen. These are
 * the things a person edits - a room renamed, a scene saved, a role changed - which until now only
 * the browser that made the edit saw. Only the kind travels, never what changed: every page reads
 * its list again with the permission that takes, so an event tells nobody what they may not read.
 */
import { z } from 'zod';

/** What part of the library changed. */
export const LIBRARY_KINDS = [
  /** The house, its floors and rooms, and where the house is. */
  'areas',
  'tags',

  /** An entity's own settings: its name, icon, room, tags, whether it is shown. */
  'entities',

  /** A device's own settings, and what it is linked to. */
  'devices',
  'scenes',

  /** Derived entities, and whether their formula works. */
  'aliases',
  'automations',
  'dashboards',

  /** Accounts and roles: what somebody may see may have changed. */
  'people',

  /** The settings the server holds. */
  'settings',

  /** The icons uploaded to the house. */
  'icons',

  /** Where backups go. */
  'backups',

  /** An integration's settings. */
  'vendors',
] as const;

/** What part of the library changed. */
export type LibraryKind = (typeof LIBRARY_KINDS)[number];

/** What `nebula.v1.event.library.changed` carries. */
export const libraryEventSchema = z.object({ kind: z.enum(LIBRARY_KINDS) });

/** What `nebula.v1.event.library.changed` carries. */
export type LibraryEvent = z.output<typeof libraryEventSchema>;
