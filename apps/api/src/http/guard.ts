/**
 * The two checks every protected route makes.
 *
 * `requireIdentity` is the one that cannot be forgotten: `request.identity` is optional in the
 * type, so a route that wants it has to come through here, and a route that skipped the
 * authentication hook fails at the first line rather than silently treating an anonymous caller
 * as authorised.
 */
import { AuthenticationError, type Identity } from '@nebula-home/contracts';
import type { FastifyRequest } from 'fastify';

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
