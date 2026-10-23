/**
 * The Authorization header of an HTTP request action: stored sealed, never served again.
 *
 * On a save, a header named `authorization` (in any case) typed in plain is sealed with the
 * installation's key (`@nebulahome/db` sealed.ts) before the row is written, and `core` opens it to
 * send it. On a read, every sealed value is masked as `{ $sealed: true, ref }`, `ref` being a hash
 * of the cipher text, and a save that sends a masked value back keeps the stored one it names.
 *
 * Only a value one of this house's automations already holds can be named that way, and a sealed
 * value a client sends as it is - copied out of a backup, say - is refused: otherwise an HTTP
 * request action could be made to send any secret the installation keeps to any address.
 */
import { createHash } from 'node:crypto';

import { ValidationError } from '@nebulahome/contracts';
import { isSealed, schema, sealSecret, type Database, type SealedValue } from '@nebulahome/db';

/**
 * Names a stored value without giving it away.
 *
 * @param sealed - The cipher text.
 * @returns The first 16 hexadecimal digits of its SHA-256.
 */
function refOf(sealed: string): string {
  return createHash('sha256').update(sealed).digest('hex').slice(0, 16);
}

/**
 * Whether a value is a JSON object.
 *
 * @param value - Anything.
 * @returns True for an object that is not an array.
 */
function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Copies a document, replacing what a visitor says to.
 *
 * @param node - The document, or any part of it.
 * @param visit - Returns a part's replacement, or undefined to copy it and go inside.
 * @returns The copy.
 */
function mapJson(node: unknown, visit: (object: Record<string, unknown>) => unknown): unknown {
  if (Array.isArray(node)) {
    return node.map((child) => mapJson(child, visit));
  }

  if (!isObject(node)) {
    return node;
  }

  return (
    visit(node) ??
    Object.fromEntries(Object.entries(node).map(([key, child]) => [key, mapJson(child, visit)]))
  );
}

/**
 * Masks every sealed value of a document, for it to leave the server.
 *
 * @param definition - An automation's document, or any part of one.
 * @returns A copy in which each reads `{ $sealed: true, ref }`.
 */
export function maskSecrets<T>(definition: T): T {
  return mapJson(definition, (object) =>
    isSealed(object) ? { $sealed: true, ref: refOf(object.$sealed) } : undefined,
  ) as T;
}

/**
 * The sealed values the automations hold now, by the ref a masked copy names them with.
 *
 * @param db - The database.
 * @returns Each, by ref.
 */
async function keptSecrets(db: Database): Promise<Map<string, SealedValue>> {
  const rows = await db
    .select({ definition: schema.registry.automations.definition })
    .from(schema.registry.automations);
  const kept = new Map<string, SealedValue>();

  for (const row of rows) {
    mapJson(row.definition, (object) => {
      if (isSealed(object)) {
        kept.set(refOf(object.$sealed), object);
      }

      return undefined;
    });
  }

  return kept;
}

/**
 * Seals what a save sends: a typed Authorization header, and a masked one back to what it names.
 *
 * @param db - The database, to find the values masked ones name.
 * @param definition - An automation's document, or one block of it.
 * @param key - The installation's key.
 * @returns A copy fit to store, or to hand `core`.
 * @throws {ValidationError} When a sealed value is not one this house holds.
 */
export async function sealSecrets<T>(db: Database, definition: T, key: Buffer): Promise<T> {
  // Read only when a masked value has to be found, which a document without one never needs.
  const kept = JSON.stringify(definition).includes('"$sealed"')
    ? await keptSecrets(db)
    : new Map<string, SealedValue>();

  /**
   * Seals one part of the document.
   *
   * @param node - The part.
   * @returns Its copy, fit to store.
   */
  const seal = (node: unknown): unknown =>
    mapJson(node, (object) => {
      if ('$sealed' in object) {
        const stored = typeof object['ref'] === 'string' ? kept.get(object['ref']) : undefined;

        if (object['$sealed'] !== true || stored === undefined) {
          throw new ValidationError(
            'A secret header is not one this house keeps: type its value again',
          );
        }

        return stored;
      }

      if (object['type'] !== 'http_request' || !Array.isArray(object['headers'])) {
        return undefined;
      }

      // The rest of the block is strings; its headers are where a secret is.
      return {
        ...object,
        headers: object['headers'].map((header: unknown) =>
          isObject(header) &&
          typeof header['name'] === 'string' &&
          header['name'].toLowerCase() === 'authorization' &&
          typeof header['value'] === 'string' &&
          header['value'] !== ''
            ? { ...header, value: sealSecret(header['value'], key) }
            : seal(header),
        ),
      };
    });

  return seal(definition) as T;
}
