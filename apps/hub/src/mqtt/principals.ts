/**
 * Who may connect to the broker: usernames, their passwords' scrypt hashes, and what each may
 * do - kept in the broker's SQLite file, `state.sqlite` in the hub's `mqtt` folder.
 *
 * Three kinds:
 *
 * - **`hub`**: the platform's hub, with every topic. One, made the first time the hub asks.
 * - **`container`**: one per container the platform runs that speaks MQTT - Zigbee2MQTT -
 *   named after its owner, with the topics it asked for. Made the first time its owner asks.
 * - **`client`**: a device the owner added on the broker's page, with a password shown once.
 *
 * The platform's two kinds are asked for their password again at every start of the hub or the
 * supervisor, so theirs is kept as well as its hash, in the same file, which only the hub reads.
 * A device's is not: it is shown when it is made, and never again.
 */
import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { promisify } from 'node:util';

import {
  ConflictError,
  MQTT_PLATFORM_PREFIX,
  MQTT_PRINCIPAL_KINDS,
  MQTT_USERNAME_PATTERN,
  ValidationError,
} from '@nebulahome/contracts';

import type { Access } from './acl.js';

/** Derives a key, promised. */
const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: Buffer,
  length: number,
) => Promise<Buffer>;

/** How long a derived key is. */
const KEY_LENGTH = 32;

/** A kind of principal. */
export type PrincipalKind = (typeof MQTT_PRINCIPAL_KINDS)[number];

/** One principal, as the page lists it: never its password or its hash. */
export type Principal = {
  readonly username: string;
  readonly kind: PrincipalKind;
  readonly label: string;
  readonly access: Access;
  readonly createdAt: string;
};

/** A principal's username and password, as the platform's services are handed them. */
export type Credentials = { readonly username: string; readonly password: string };

/** A row, as SQLite answers it. */
type Row = {
  readonly username: string;
  readonly kind: string;
  readonly label: string;
  readonly salt: Uint8Array;
  readonly hash: Uint8Array;
  readonly access: string;
  readonly created_at: string;
  readonly password: string | null;
};

/**
 * A password nobody has to type: 24 random bytes, as URL-safe base64.
 *
 * @returns It.
 */
function newPassword(): string {
  return randomBytes(24).toString('base64url');
}

/** The principals, in the broker's SQLite file. */
export class PrincipalStore {
  readonly #db: DatabaseSync;

  /**
   * Makes the table the first time.
   *
   * @param db - The broker's file, open; its owner closes it.
   */
  public constructor(db: DatabaseSync) {
    this.#db = db;
    this.#db.exec(`
      CREATE TABLE IF NOT EXISTS principals (
        username TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        label TEXT NOT NULL,
        salt BLOB NOT NULL,
        hash BLOB NOT NULL,
        access TEXT NOT NULL,
        created_at TEXT NOT NULL,
        password TEXT
      ) STRICT
    `);
  }

  /**
   * Every principal, the platform's first.
   *
   * @returns Them.
   */
  public list(): Principal[] {
    const rows = this.#db
      .prepare('SELECT * FROM principals ORDER BY kind, username')
      .all() as unknown as Row[];

    return rows.map((row) => this.#principalOf(row));
  }

  /**
   * Checks a username and password.
   *
   * @param username - What the client sent.
   * @param password - What it sent with it.
   * @returns The principal, or null when either is wrong.
   */
  public async verify(username: string, password: string): Promise<Principal | null> {
    const row = this.#row(username);

    if (row === undefined) {
      // As long as a right one takes, so a wrong username is not told apart by its speed.
      await scrypt(password, randomBytes(16), KEY_LENGTH);

      return null;
    }

    const derived = await scrypt(password, Buffer.from(row.salt), KEY_LENGTH);

    return timingSafeEqual(derived, Buffer.from(row.hash)) ? this.#principalOf(row) : null;
  }

  /**
   * The credentials of one of the platform's principals, made the first time.
   *
   * @param username - `nebula-hub`, `nebula-vendor-zigbee2mqtt`.
   * @param kind - `hub` or `container`.
   * @param label - What the page calls it.
   * @param access - What it may do; a principal already made is given it again.
   * @returns Its username and password.
   */
  public async platformCredentials(
    username: string,
    kind: 'hub' | 'container',
    label: string,
    access: Access,
  ): Promise<Credentials> {
    const found = this.#row(username);

    if (found?.password !== null && found?.password !== undefined) {
      this.#db
        .prepare('UPDATE principals SET access = ?, label = ? WHERE username = ?')
        .run(JSON.stringify(access), label, username);

      return { username, password: found.password };
    }

    const password = newPassword();

    await this.#write(username, kind, label, access, password, true);

    return { username, password };
  }

  /**
   * Adds a device's principal.
   *
   * @param username - Its username.
   * @param label - What the page calls it.
   * @param access - What it may do.
   * @returns Its password, shown once.
   * @throws {ValidationError} When the username is not one a client accepts.
   * @throws {ConflictError} When it is taken.
   */
  public async addClient(username: string, label: string, access: Access): Promise<string> {
    if (!MQTT_USERNAME_PATTERN.test(username) || username.startsWith(MQTT_PLATFORM_PREFIX)) {
      throw new ValidationError(
        `A username is lower-case letters, digits, dashes and underscores, and never begins with ${MQTT_PLATFORM_PREFIX}`,
        { details: { username } },
      );
    }

    if (this.#row(username) !== undefined) {
      throw new ConflictError(`${username} is taken`, { details: { username } });
    }

    const password = newPassword();

    await this.#write(username, 'client', label, access, password, false);

    return password;
  }

  /**
   * Removes a device's principal. The platform's are not removed here.
   *
   * @param username - Its username.
   * @returns Whether there was one.
   */
  public removeClient(username: string): boolean {
    const result = this.#db
      .prepare("DELETE FROM principals WHERE username = ? AND kind = 'client'")
      .run(username);

    return Number(result.changes) > 0;
  }

  /**
   * Writes a principal.
   *
   * @param username - Its username.
   * @param kind - Its kind.
   * @param label - What the page calls it.
   * @param access - What it may do.
   * @param password - Its password.
   * @param isPasswordKept - Whether it is kept beside its hash, for the platform's.
   */
  async #write(
    username: string,
    kind: PrincipalKind,
    label: string,
    access: Access,
    password: string,
    isPasswordKept: boolean,
  ): Promise<void> {
    const salt = randomBytes(16);
    const hash = await scrypt(password, salt, KEY_LENGTH);

    this.#db
      .prepare(
        `INSERT OR REPLACE INTO principals
           (username, kind, label, salt, hash, access, created_at, password)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        username,
        kind,
        label,
        salt,
        hash,
        JSON.stringify(access),
        new Date().toISOString(),
        isPasswordKept ? password : null,
      );
  }

  /**
   * One row.
   *
   * @param username - Its username.
   * @returns It, if there is one.
   */
  #row(username: string): Row | undefined {
    return this.#db.prepare('SELECT * FROM principals WHERE username = ?').get(username) as
      Row | undefined;
  }

  /**
   * A row as the page reads it.
   *
   * @param row - The row.
   * @returns The principal.
   */
  #principalOf(row: Row): Principal {
    const kind = MQTT_PRINCIPAL_KINDS.find((each) => each === row.kind) ?? 'client';
    let access: Access;

    try {
      access = JSON.parse(row.access) as Access;
    } catch {
      access = { publish: [], subscribe: [] };
    }

    return { username: row.username, kind, label: row.label, access, createdAt: row.created_at };
  }
}
