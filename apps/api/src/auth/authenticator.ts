/**
 * Turning an `Authorization` header into an identity.
 *
 * Two credentials arrive on the same header and are told apart by their shape: a personal access
 * token starts with a known prefix, everything else is treated as a JWT. That is deliberate -
 * asking the client to declare which kind it is sending would let a caller choose the cheaper
 * verification path for a credential of the other kind.
 *
 * A session token is verified with arithmetic and no database. A personal access token needs the
 * database, because its whole purpose is to be revocable and to be narrowed by its owner's
 * current permissions.
 */
import {
  AuthenticationError,
  PERSONAL_ACCESS_TOKEN_PREFIX,
  parsePermission,
  type GrantedPermission,
  type Identity,
} from '@nebula-home/contracts';
import type { Database } from '@nebula-home/db';

import { intersectGrants, resolveGrants } from './permissions.js';
import {
  findAccessToken,
  findUserById,
  readAccessTokenGrants,
  readIdentityGrants,
} from './repository.js';
import { hashOpaqueToken, verifyAccessToken } from './tokens.js';

/** What the authenticator needs to do its work. */
export type AuthenticatorOptions = {
  /** The database, for personal access tokens. */
  readonly db: Database;

  /** The access-token signing key. */
  readonly secret: Uint8Array;

  /** The clock, injectable for tests. */
  readonly now?: () => Date;
};

/**
 * Reads the bearer credential out of a request's headers.
 *
 * @param header - The raw `Authorization` value.
 * @returns The credential, or undefined when the header is absent or not a bearer.
 */
export function readBearer(header: string | string[] | undefined): string | undefined {
  const value = Array.isArray(header) ? header[0] : header;

  if (typeof value !== 'string') {
    return undefined;
  }

  const match = /^Bearer[ ]+(?<token>\S+)$/.exec(value);

  return match?.groups?.['token'];
}

/** Verifies credentials and produces identities. */
export class Authenticator {
  /** The database. */
  readonly #db: Database;

  /** The access-token signing key. */
  readonly #secret: Uint8Array;

  /** The clock. */
  readonly #now: () => Date;

  /**
   * Creates the authenticator.
   *
   * @param options - The database, the signing key and the clock.
   */
  public constructor(options: AuthenticatorOptions) {
    this.#db = options.db;
    this.#secret = options.secret;
    this.#now = options.now ?? ((): Date => new Date());
  }

  /**
   * Verifies whatever was presented.
   *
   * @param credential - The bearer value.
   * @returns Who the request is from.
   * @throws {AuthenticationError} When the credential is absent, unreadable, expired, revoked, or
   * belongs to a user who no longer exists or has been deactivated.
   */
  public async authenticate(credential: string | undefined): Promise<Identity> {
    if (credential === undefined || credential === '') {
      throw new AuthenticationError('No credentials were presented');
    }

    return credential.startsWith(PERSONAL_ACCESS_TOKEN_PREFIX)
      ? this.#fromAccessToken(credential)
      : this.#fromSessionToken(credential);
  }

  /**
   * Verifies a signed access token.
   *
   * No database read: that is the whole point of a signed claim, and it is why the token's
   * lifetime is short. A user deactivated one minute ago still has a working token for up to
   * fifteen; the session behind it cannot be refreshed, so it stops there.
   *
   * @param token - The compact JWS.
   * @returns Who the request is from.
   */
  async #fromSessionToken(token: string): Promise<Identity> {
    const claims = await verifyAccessToken(token, this.#secret);
    const permissions: GrantedPermission[] = [];

    for (const entry of claims.prm) {
      const parsed = parsePermission(entry);

      // A claim entry that does not parse is dropped rather than failing the request: it means
      // this build has met a permission it does not know, which is version skew, and refusing
      // the whole token would lock out every user during a rolling upgrade.
      if (parsed !== null) {
        permissions.push(parsed);
      }
    }

    return {
      userId: claims.sub,
      username: claims.usr,
      role: claims.rol,
      permissions,
      credential: 'session',
      sessionId: claims.sid,
    };
  }

  /**
   * Verifies a personal access token.
   *
   * @param secret - The token as presented, prefix included.
   * @returns Who the request is from, with permissions narrowed to the intersection of the
   * token's declared set and its owner's current one.
   * @throws {AuthenticationError} When the token is unknown, revoked, expired, or its owner is
   * gone or deactivated. One message for all of them, so a caller cannot probe which.
   */
  async #fromAccessToken(secret: string): Promise<Identity> {
    const record = await findAccessToken(this.#db, hashOpaqueToken(secret));
    const now = this.#now();

    if (
      record?.revokedAt !== null ||
      (record.expiresAt !== null && record.expiresAt.getTime() <= now.getTime())
    ) {
      throw new AuthenticationError('Access token is not valid');
    }

    const user = await findUserById(this.#db, record.userId);

    if (!user?.isActive) {
      throw new AuthenticationError('Access token is not valid');
    }

    const [ownerGrants, tokenGrants] = await Promise.all([
      readIdentityGrants(this.#db, user, (roleGrants, userGrants) =>
        resolveGrants(roleGrants, userGrants, now),
      ),
      readAccessTokenGrants(this.#db, record.id),
    ]);

    return {
      userId: user.id,
      username: user.username,
      role: user.roleKey,
      permissions: intersectGrants(ownerGrants, tokenGrants),
      credential: 'access_token',
      accessTokenId: record.id,
    };
  }
}
