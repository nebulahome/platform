/**
 * A package's identifier, apart from the manifest: the integrations' instance ids share its
 * pattern, and the modules that need only the pattern must not pull the manifest's whole grammar
 * - and what that imports - in with it.
 */
import { z } from 'zod';

/**
 * A package identifier: `mqtt`, `nvr`.
 *
 * Mirrors `packages_id_format` in DATABASE.md. It shares one namespace with the integrations'
 * instance ids, since both answer `svc.<id>.command`.
 */
export const PACKAGE_ID_PATTERN = /^[a-z][a-z0-9-]{1,63}$/;

/**
 * The ids no package may take: the platform's services answer `svc.<id>.*` under them, and
 * `system` and `derived` are sources of entity state that are not packages.
 */
export const RESERVED_PACKAGE_IDS = [
  'api',
  'backup',
  'core',
  'derived',
  'hub',
  'logger',
  'nebula',
  'packet-manager',
  'platform',
  'proxy',
  'supervisor',
  'system',
  'web-ui',
] as const;

/** The reserved ids, for a quick look-up. */
const RESERVED = new Set<string>(RESERVED_PACKAGE_IDS);

/** Validates a package identifier. */
export const packageIdSchema = z
  .string()
  .regex(PACKAGE_ID_PATTERN, 'Must be a package id')
  .refine((id) => !RESERVED.has(id), {
    message: 'Is the name of a part of the platform, which no package may take',
  });

/**
 * The subject tokens under a package's id that are the platform's, never a service of the
 * package's own: its commands, its methods, its settings, and those kept for what is planned - a
 * package's health, its events, what it says of itself - and anything starting with `_`.
 */
export const RESERVED_PACKAGE_SERVICES = [
  'command',
  'rpc',
  'settings',
  'health',
  'events',
  'info',
] as const;

/**
 * Says whether a service name is one a package may provide.
 *
 * @param name - The name.
 * @returns False for a reserved one.
 */
export function isPackageServiceAllowed(name: string): boolean {
  return !name.startsWith('_') && !RESERVED_PACKAGE_SERVICES.some((reserved) => reserved === name);
}
