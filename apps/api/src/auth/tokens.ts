/**
 * Issuing and checking the two kinds of token.
 *
 * They are deliberately different things. An **access token** is a signed claim: it is checked
 * with arithmetic, needs no database, and therefore cannot be revoked - which is why it lives
 * fifteen minutes. A **refresh token** is an opaque random string whose SHA-256 is a row: it
 * needs a database round-trip, and therefore can be revoked, rotated and caught being reused.
 *
 * Only the digest of an opaque token is stored. A database dump is then not a set of working
 * credentials, which is the same reason passwords are hashed.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import {
  ACCESS_TOKEN_ALGORITHM,
  ACCESS_TOKEN_AUDIENCE,
  ACCESS_TOKEN_ISSUER,
  ACCESS_TOKEN_TTL_SECONDS,
  AuthenticationError,
  OPAQUE_TOKEN_BYTES,
  accessTokenClaimsSchema,
  formatPermission,
  type AccessTokenClaims,
  type GrantedPermission,
} from '@nebula-home/contracts';
import { SignJWT, jwtVerify, type JWTPayload } from 'jose';

/** What goes into a freshly issued access token. */
export type AccessTokenSubject = {
  /** The user it belongs to. */
  readonly userId: string;

  /** The session it was issued under. */
  readonly sessionId: string;

  /** Their username at the moment of issue. */
  readonly username: string;

  /** Their role key at the moment of issue. */
  readonly role: string;

  /** The resolved allow set. */
  readonly permissions: readonly GrantedPermission[];
};

/**
 * Signs an access token.
 *
 * @param subject - Who the token is for and what they may do.
 * @param secret - The signing key, from `API_JWT_SECRET`.
 * @param now - The clock, injectable so tests can pin `iat` and `exp`.
 * @returns The compact JWS.
 */
export async function signAccessToken(
  subject: AccessTokenSubject,
  secret: Uint8Array,
  now: () => Date = () => new Date(),
): Promise<string> {
  const issuedAt = Math.floor(now().getTime() / 1000);

  return new SignJWT({
    usr: subject.username,
    rol: subject.role,
    prm: subject.permissions.map(formatPermission),
  })
    .setProtectedHeader({ alg: ACCESS_TOKEN_ALGORITHM })
    .setSubject(subject.userId)
    .setJti(subject.sessionId)
    .setIssuer(ACCESS_TOKEN_ISSUER)
    .setAudience(ACCESS_TOKEN_AUDIENCE)
    .setIssuedAt(issuedAt)
    .setExpirationTime(issuedAt + ACCESS_TOKEN_TTL_SECONDS)
    .sign(secret);
}

/**
 * Verifies an access token and reads its claims.
 *
 * @param token - The compact JWS from the `Authorization` header.
 * @param secret - The signing key.
 * @returns The validated claims.
 * @throws {AuthenticationError} When the signature, the issuer, the audience, the expiry or the
 * claim shape is wrong. One error for all of them: telling a caller which part failed helps
 * nobody but someone probing the token format.
 */
export async function verifyAccessToken(
  token: string,
  secret: Uint8Array,
): Promise<AccessTokenClaims> {
  let payload: JWTPayload;

  try {
    const verified = await jwtVerify(token, secret, {
      issuer: ACCESS_TOKEN_ISSUER,
      audience: ACCESS_TOKEN_AUDIENCE,
      algorithms: [ACCESS_TOKEN_ALGORITHM],
    });

    payload = verified.payload;
  } catch (cause: unknown) {
    throw new AuthenticationError('Access token is not valid', { cause });
  }

  const claims = accessTokenClaimsSchema.safeParse({
    sub: payload.sub,
    sid: payload.jti,
    usr: payload['usr'],
    rol: payload['rol'],
    prm: payload['prm'],
    iat: payload.iat,
    exp: payload.exp,
  });

  if (!claims.success) {
    throw new AuthenticationError('Access token is not valid');
  }

  return claims.data;
}

/** A generated opaque token, in both the form the caller gets and the form that is stored. */
export type OpaqueToken = {
  /** What the caller receives. Never stored. */
  readonly secret: string;

  /** What goes in the database. */
  readonly digest: Buffer;
};

/**
 * Generates an opaque token.
 *
 * @param prefix - Prepended to the secret so it is recognisable, e.g. `nbh_`. Not hashed with
 * it: the prefix is public and adds no entropy, and hashing it in would only make the digest
 * depend on a constant.
 * @returns The secret to hand out and the digest to store.
 */
export function generateOpaqueToken(prefix = ''): OpaqueToken {
  const secret = prefix + randomBytes(OPAQUE_TOKEN_BYTES).toString('base64url');

  return { secret, digest: hashOpaqueToken(secret) };
}

/**
 * Digests an opaque token for storage and lookup.
 *
 * SHA-256 rather than argon2id, deliberately. A password is short and human-chosen, so it needs
 * a slow hash to survive an offline attack; this token is 256 bits of randomness, where no
 * amount of hashing rate helps an attacker and a slow hash would only add latency to every
 * request that presents one.
 *
 * @param secret - The token as presented.
 * @returns Its SHA-256.
 */
export function hashOpaqueToken(secret: string): Buffer {
  return createHash('sha256').update(secret, 'utf8').digest();
}

/**
 * Compares two digests without leaking where they diverge.
 *
 * @param a - One digest.
 * @param b - The other.
 * @returns True when they are identical.
 */
export function digestsMatch(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}
