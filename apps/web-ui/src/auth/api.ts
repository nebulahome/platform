/**
 * The authentication calls, one function per endpoint.
 *
 * Each names the contract schema its answer must satisfy, so the browser and the server are held
 * to the same definition rather than to two copies of it. There is no hand-written response type
 * in this file, and there should never be one: a type written here could agree with the server
 * today and quietly stop agreeing tomorrow.
 */
import { z } from 'zod';

import {
  authenticatedResponseSchema,
  loginResponseSchema,
  sessionUserSchema,
  setupResponseSchema,
  setupStatusSchema,
  type AuthenticatedResponse,
  type LoginResponse,
  type SessionUser,
  type SetupRequest,
  type SetupStatus,
} from '@nebulahome/contracts';

import { apiRequest } from '@/lib/api-client';

/**
 * Asks whether this installation still needs its first account.
 *
 * @param signal - Cancels the request.
 * @returns Whether the setup flow is open.
 */
export async function fetchSetupStatus(signal?: AbortSignal): Promise<SetupStatus> {
  return apiRequest('/setup', setupStatusSchema, {
    isAuthenticated: false,
    ...(signal === undefined ? {} : { signal }),
  });
}

/**
 * Creates the first owner and signs them in.
 *
 * @param request - The account to create.
 * @returns The tokens and the new account.
 */
export async function completeSetup(request: SetupRequest): Promise<AuthenticatedResponse> {
  return apiRequest('/setup', setupResponseSchema, {
    method: 'POST',
    body: request,
    isAuthenticated: false,
  });
}

/**
 * Exchanges a username and password.
 *
 * @param username - What they typed.
 * @param password - What they typed.
 * @returns Either the tokens or a two-factor challenge.
 */
export async function signIn(username: string, password: string): Promise<LoginResponse> {
  return apiRequest('/auth/login', loginResponseSchema, {
    method: 'POST',
    body: { username, password },
    isAuthenticated: false,
  });
}

/**
 * Completes a sign-in with a one-time code or a recovery code.
 *
 * @param challengeId - From the login response.
 * @param code - What they typed.
 * @returns The tokens and the account.
 */
export async function submitSecondFactor(
  challengeId: string,
  code: string,
): Promise<AuthenticatedResponse> {
  return apiRequest('/auth/two-factor', authenticatedResponseSchema, {
    method: 'POST',
    body: { challengeId, code },
    isAuthenticated: false,
  });
}

/**
 * Reads who the current credential belongs to.
 *
 * @param signal - Cancels the request.
 * @returns The signed-in user.
 */
export async function fetchSession(signal?: AbortSignal): Promise<SessionUser> {
  return apiRequest('/auth/session', sessionUserSchema, {
    ...(signal === undefined ? {} : { signal }),
  });
}

/**
 * Ends the session.
 *
 * @param allSessions - Whether to end every session this person has.
 */
export async function signOut(allSessions = false): Promise<void> {
  // `204`, so there is nothing to validate. `z.undefined()` says that rather than leaving the
  // call untyped, and it fails loudly if the endpoint ever starts answering with a body.
  await apiRequest('/auth/logout', z.undefined(), {
    method: 'POST',
    body: { allSessions },
  });
}
