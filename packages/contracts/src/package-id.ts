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

/** Validates a package identifier. */
export const packageIdSchema = z.string().regex(PACKAGE_ID_PATTERN, 'Must be a package id');
