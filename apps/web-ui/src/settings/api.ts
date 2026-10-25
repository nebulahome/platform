/**
 * Every call the settings section makes, one function per endpoint.
 *
 * As in `auth/api.ts`, each names the contract schema its answer must satisfy rather than
 * declaring a response type here. A type written in this file could agree with the server today
 * and stop agreeing after a deployment, and nothing would say so.
 *
 * The endpoints that answer `204` are validated against `z.undefined()`. That is not ceremony:
 * it is the assertion that they still answer with nothing, so an endpoint that starts returning
 * a body fails here rather than having it silently dropped.
 */
import { z } from 'zod';

import {
  accessTokenViewSchema,
  createAccessTokenResponseSchema,
  roleViewSchema,
  sessionViewSchema,
  settingsResponseSchema,
  twoFactorConfirmResponseSchema,
  twoFactorSetupResponseSchema,
  userViewSchema,
  type AccessTokenView,
  type CreateAccessTokenRequest,
  type CreateAccessTokenResponse,
  type CreateUserRequest,
  type JsonValue,
  type RoleCreate,
  type RoleUpdate,
  type RoleView,
  type SessionView,
  type SetAvatarRequest,
  type SettingsResponse,
  type TwoFactorConfirmResponse,
  type TwoFactorSetupResponse,
  type UpdateUserRequest,
  type UserView,
} from '@nebulahome/contracts';

import { apiRequest } from '@/lib/api-client';

/**
 * A collection response.
 *
 * @param item - What one entry looks like.
 * @returns The schema of a whole collection of them.
 */
const collectionSchema = <TItem extends z.ZodType>(
  item: TItem,
): z.ZodObject<{ items: z.ZodArray<TItem> }> => z.object({ items: z.array(item) });

/**
 * Lists everyone with an account.
 *
 * @param signal - Cancels the request.
 * @returns Every living account.
 */
export async function fetchUsers(signal?: AbortSignal): Promise<UserView[]> {
  const { items } = await apiRequest('/users', collectionSchema(userViewSchema), {
    ...(signal === undefined ? {} : { signal }),
  });

  return items;
}

/**
 * Creates an account.
 *
 * @param request - The account to create.
 * @returns The new account.
 */
export async function createUser(request: CreateUserRequest): Promise<UserView> {
  return apiRequest('/users', userViewSchema, { method: 'POST', body: request });
}

/**
 * Changes an account.
 *
 * @param userId - Whose.
 * @param request - What to change.
 * @returns The account as it now stands.
 */
export async function updateUser(userId: string, request: UpdateUserRequest): Promise<UserView> {
  return apiRequest(`/users/${userId}`, userViewSchema, { method: 'PATCH', body: request });
}

/**
 * Deletes an account.
 *
 * @param userId - Whose.
 */
export async function deleteUser(userId: string): Promise<void> {
  await apiRequest(`/users/${userId}`, z.undefined(), { method: 'DELETE' });
}

/**
 * Stores a picture for an account.
 *
 * @param userId - Whose.
 * @param upload - The resized image and its format.
 * @returns The account as it now stands.
 */
export async function setAvatar(userId: string, upload: SetAvatarRequest): Promise<UserView> {
  return apiRequest(`/users/${userId}/avatar`, userViewSchema, { method: 'PUT', body: upload });
}

/**
 * Removes the picture from an account.
 *
 * @param userId - Whose.
 */
export async function removeAvatar(userId: string): Promise<void> {
  await apiRequest(`/users/${userId}/avatar`, z.undefined(), { method: 'DELETE' });
}

/**
 * Lists the roles and what each one grants.
 *
 * @param signal - Cancels the request.
 * @returns Every role.
 */
export async function fetchRoles(signal?: AbortSignal): Promise<RoleView[]> {
  const { items } = await apiRequest('/roles', collectionSchema(roleViewSchema), {
    ...(signal === undefined ? {} : { signal }),
  });

  return items;
}

/**
 * Makes a custom role, perhaps from another role's permissions.
 *
 * @param request - Its name, description, icon and the role to start from.
 * @returns The role.
 */
export async function createRole(request: RoleCreate): Promise<RoleView> {
  return apiRequest('/roles', roleViewSchema, { method: 'POST', body: request });
}

/**
 * Changes a custom role's details or its whole set of permissions.
 *
 * @param roleId - Which.
 * @param request - What to change.
 * @returns The role as it now stands.
 */
export async function updateRole(roleId: string, request: RoleUpdate): Promise<RoleView> {
  return apiRequest(`/roles/${roleId}`, roleViewSchema, { method: 'PATCH', body: request });
}

/**
 * Deletes a custom role.
 *
 * @param roleId - Which.
 * @param moveTo - The key of the role its people move to; needed when it has any.
 */
export async function deleteRole(roleId: string, moveTo?: string): Promise<void> {
  const query = moveTo === undefined ? '' : `?moveTo=${encodeURIComponent(moveTo)}`;

  await apiRequest(`/roles/${roleId}${query}`, z.undefined(), { method: 'DELETE' });
}

/**
 * Changes your own password.
 *
 * @param currentPassword - The one in use now, which the endpoint requires even though the
 * caller is already authenticated.
 * @param newPassword - The new one.
 */
export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  await apiRequest('/users/me/password', z.undefined(), {
    method: 'POST',
    body: { currentPassword, newPassword },
  });
}

/**
 * Lists your own signed-in browsers and apps.
 *
 * @param signal - Cancels the request.
 * @returns Every session, the current one marked.
 */
export async function fetchSessions(signal?: AbortSignal): Promise<SessionView[]> {
  const { items } = await apiRequest('/users/me/sessions', collectionSchema(sessionViewSchema), {
    ...(signal === undefined ? {} : { signal }),
  });

  return items;
}

/**
 * Ends one of your own sessions.
 *
 * @param sessionId - Which one.
 */
export async function revokeSession(sessionId: string): Promise<void> {
  await apiRequest(`/users/me/sessions/${sessionId}`, z.undefined(), { method: 'DELETE' });
}

/**
 * Lists your own personal access tokens.
 *
 * @param signal - Cancels the request.
 * @returns Every token, without its secret.
 */
export async function fetchAccessTokens(signal?: AbortSignal): Promise<AccessTokenView[]> {
  const { items } = await apiRequest('/users/me/tokens', collectionSchema(accessTokenViewSchema), {
    ...(signal === undefined ? {} : { signal }),
  });

  return items;
}

/**
 * Issues a personal access token.
 *
 * @param request - What to call it and what it may do.
 * @returns The token and its secret, which is the only time the secret exists.
 */
export async function createAccessToken(
  request: CreateAccessTokenRequest,
): Promise<CreateAccessTokenResponse> {
  return apiRequest('/users/me/tokens', createAccessTokenResponseSchema, {
    method: 'POST',
    body: request,
  });
}

/**
 * Revokes one of your own personal access tokens.
 *
 * @param tokenId - Which one.
 */
export async function revokeAccessToken(tokenId: string): Promise<void> {
  await apiRequest(`/users/me/tokens/${tokenId}`, z.undefined(), { method: 'DELETE' });
}

/**
 * Begins two-factor enrolment.
 *
 * Nothing is enforced yet at this point: the secret is stored unconfirmed, and only confirming
 * a generated code turns it on.
 *
 * @returns The secret and the `otpauth://` URI.
 */
export async function beginTwoFactorEnrolment(): Promise<TwoFactorSetupResponse> {
  return apiRequest('/users/me/two-factor', twoFactorSetupResponseSchema, { method: 'POST' });
}

/**
 * Confirms two-factor enrolment.
 *
 * @param code - A code from the authenticator, proving it was set up correctly.
 * @returns The recovery codes, shown exactly once.
 */
export async function confirmTwoFactorEnrolment(code: string): Promise<TwoFactorConfirmResponse> {
  return apiRequest('/users/me/two-factor/confirm', twoFactorConfirmResponseSchema, {
    method: 'POST',
    body: { code },
  });
}

/**
 * Turns two-factor authentication off.
 */
export async function disableTwoFactor(): Promise<void> {
  await apiRequest('/users/me/two-factor', z.undefined(), { method: 'DELETE' });
}

/**
 * Reads the settings the server holds.
 *
 * @param signal - Cancels the request.
 * @returns Every setting, its default, and who last changed it.
 */
export async function fetchServerSettings(signal?: AbortSignal): Promise<SettingsResponse> {
  return apiRequest('/settings', settingsResponseSchema, {
    ...(signal === undefined ? {} : { signal }),
  });
}

/**
 * Changes settings the server holds.
 *
 * @param changes - The settings to change, by key. Sent as a partial map so that two people
 * editing different settings at the same time do not overwrite each other.
 * @returns Every setting as it now stands, which is not necessarily what was asked for: one key
 * can be refused because of another.
 */
export async function updateServerSettings(
  changes: Readonly<Record<string, JsonValue>>,
): Promise<SettingsResponse> {
  return apiRequest('/settings', settingsResponseSchema, { method: 'PATCH', body: { changes } });
}

/**
 * The keys the settings section caches under.
 *
 * Collected here rather than written at each call site, because the pages that read a list and
 * the ones that change it are different files - and a mutation that invalidates a key nobody
 * caches under is a screen that silently shows stale rows.
 */
export const SETTINGS_QUERY_KEYS = {
  /** Everyone with an account. */
  users: ['settings', 'users'] as const,

  /** The roles and what they grant. */
  roles: ['settings', 'roles'] as const,

  /** Your own signed-in browsers and apps. */
  sessions: ['settings', 'sessions'] as const,

  /** Your own personal access tokens. */
  accessTokens: ['settings', 'access-tokens'] as const,

  /** The settings the server holds. */
  server: ['settings', 'server'] as const,
} as const;
