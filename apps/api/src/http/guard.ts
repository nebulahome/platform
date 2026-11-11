/**
 * The checks every protected route makes.
 *
 * `requireIdentity` is the one that cannot be forgotten: `request.identity` is optional in the
 * type, so a route that wants it has to come through here, and a route that skipped the
 * authentication hook fails at the first line rather than silently treating an anonymous caller
 * as authorised.
 */
import type { FastifyRequest } from 'fastify';

import { AuthenticationError, type Identity } from '@nebulahome/contracts';

/**
 * Reads the identity the authentication hook attached.
 *
 * @param request - The request being handled.
 * @returns Who it is from.
 * @throws {AuthenticationError} When no credential was verified for this request.
 */
export function requireIdentity(request: FastifyRequest): Identity {
  if (request.identity === undefined) {
    throw new AuthenticationError('No credentials were presented');
  }

  return request.identity;
}

/**
 * Refuses a personal access token where only a signed-in session will do: whatever changes how
 * the account itself is signed into. A token scoped to reading lights must not mint more tokens,
 * change the password or turn the second factor off.
 *
 * @param identity - Who is asking.
 * @throws {AuthenticationError} With a personal access token.
 */
export function requireSession(identity: Identity): void {
  if (identity.credential !== 'session') {
    throw new AuthenticationError('This needs a signed-in session, not an access token');
  }
}
