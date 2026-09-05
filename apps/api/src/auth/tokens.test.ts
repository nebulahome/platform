/**
 * Token issuing and verification.
 *
 * The interesting cases are the rejections. A signature check that accepts a tampered token, or
 * an audience check that accepts a token minted for something else, fails silently and stays
 * failing, so each of those has its own case here.
 */
import {
  ACCESS_TOKEN_TTL_SECONDS,
  AuthenticationError,
  PERSONAL_ACCESS_TOKEN_PREFIX,
  type GrantedPermission,
} from '@nebula-home/contracts';
import { SignJWT, decodeJwt } from 'jose';
import { describe, expect, it } from 'vitest';

import {
  digestsMatch,
  generateOpaqueToken,
  hashOpaqueToken,
  signAccessToken,
  verifyAccessToken,
} from './tokens.js';

/** A signing key of the length the configuration requires. */
const SECRET = new TextEncoder().encode('a-test-signing-key-of-at-least-32-chars');

/** A different one, for the tampering cases. */
const OTHER_SECRET = new TextEncoder().encode('another-test-signing-key-32-chars-long');

/** The permissions a test token carries. */
const PERMISSIONS: GrantedPermission[] = [
  { key: 'entity:read', scope: '*', effect: 'allow' },
  { key: 'entity:control', scope: 'area.hallway', effect: 'allow' },
  { key: 'entity:control', scope: 'area.garage', effect: 'deny' },
];

/** Who the test tokens are for. */
const SUBJECT = {
  userId: '00000000-0000-4000-8000-000000000001',
  sessionId: '00000000-0000-4000-8000-000000000002',
  username: 'tester',
  role: 'member',
  permissions: PERMISSIONS,
};

describe('access tokens', () => {
  it('round-trips a subject through a signature', async () => {
    const token = await signAccessToken(SUBJECT, SECRET);
    const claims = await verifyAccessToken(token, SECRET);

    expect(claims.sub).toBe(SUBJECT.userId);
    expect(claims.sid).toBe(SUBJECT.sessionId);
    expect(claims.usr).toBe('tester');
    expect(claims.rol).toBe('member');
  });

  it('encodes a denial so it survives the round trip', async () => {
    const token = await signAccessToken(SUBJECT, SECRET);
    const claims = await verifyAccessToken(token, SECRET);

    expect(claims.prm).toContain('entity:read');
    expect(claims.prm).toContain('entity:control:area.hallway');
    expect(claims.prm).toContain('!entity:control:area.garage');
  });

  it('expires exactly one lifetime after it was issued', async () => {
    // Read without verifying, deliberately: verification checks the expiry against the real
    // clock, which would make this assertion about the arithmetic depend on today's date.
    const issuedAt = new Date('2026-01-01T00:00:00Z');
    const claims = decodeJwt(await signAccessToken(SUBJECT, SECRET, () => issuedAt));

    expect(claims.iat).toBe(issuedAt.getTime() / 1000);
    expect((claims.exp ?? 0) - (claims.iat ?? 0)).toBe(ACCESS_TOKEN_TTL_SECONDS);
  });

  it('refuses a token signed with another key', async () => {
    const token = await signAccessToken(SUBJECT, OTHER_SECRET);

    await expect(verifyAccessToken(token, SECRET)).rejects.toThrow(AuthenticationError);
  });

  it('refuses a token whose payload was edited', async () => {
    const token = await signAccessToken(SUBJECT, SECRET);
    const [header, payload, signature] = token.split('.');
    const edited = JSON.parse(Buffer.from(payload ?? '', 'base64url').toString('utf8')) as Record<
      string,
      unknown
    >;

    edited['prm'] = ['package:install'];

    const forged = [
      header,
      Buffer.from(JSON.stringify(edited), 'utf8').toString('base64url'),
      signature,
    ].join('.');

    await expect(verifyAccessToken(forged, SECRET)).rejects.toThrow(AuthenticationError);
  });

  it('refuses a token minted for a different audience', async () => {
    const foreign = await new SignJWT({ usr: 'tester', rol: 'member', prm: [] })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(SUBJECT.userId)
      .setJti(SUBJECT.sessionId)
      .setIssuer('nebula-home')
      .setAudience('somebody-else')
      .setIssuedAt()
      .setExpirationTime('15m')
      .sign(SECRET);

    await expect(verifyAccessToken(foreign, SECRET)).rejects.toThrow(AuthenticationError);
  });

  it('refuses a token that has already expired', async () => {
    const expired = await signAccessToken(SUBJECT, SECRET, () => new Date('2020-01-01T00:00:00Z'));

    await expect(verifyAccessToken(expired, SECRET)).rejects.toThrow(AuthenticationError);
  });

  it('refuses a token missing a claim it needs', async () => {
    const incomplete = await new SignJWT({ usr: 'tester', rol: 'member' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(SUBJECT.userId)
      .setJti(SUBJECT.sessionId)
      .setIssuer('nebula-home')
      .setAudience('nebula-home-api')
      .setIssuedAt()
      .setExpirationTime('15m')
      .sign(SECRET);

    await expect(verifyAccessToken(incomplete, SECRET)).rejects.toThrow(AuthenticationError);
  });

  it('refuses a token that is not a token at all', async () => {
    await expect(verifyAccessToken('not-a-jwt', SECRET)).rejects.toThrow(AuthenticationError);
  });
});

describe('opaque tokens', () => {
  it('carries the prefix it was asked for', () => {
    const token = generateOpaqueToken(PERSONAL_ACCESS_TOKEN_PREFIX);

    expect(token.secret.startsWith(PERSONAL_ACCESS_TOKEN_PREFIX)).toBe(true);
  });

  it('never produces the same secret twice', () => {
    const secrets = new Set(Array.from({ length: 200 }, () => generateOpaqueToken().secret));

    expect(secrets.size).toBe(200);
  });

  it('stores a digest, not the secret', () => {
    const token = generateOpaqueToken();

    expect(token.digest.toString('hex')).not.toContain(token.secret);
    expect(token.digest).toHaveLength(32);
  });

  it('recomputes the same digest from the presented secret', () => {
    const token = generateOpaqueToken();

    expect(digestsMatch(hashOpaqueToken(token.secret), token.digest)).toBe(true);
  });

  it('does not match a different secret', () => {
    const token = generateOpaqueToken();

    expect(digestsMatch(hashOpaqueToken(`${token.secret}x`), token.digest)).toBe(false);
  });
});
