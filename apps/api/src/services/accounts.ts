/**
 * The accounts an integration signs in with, as `api` serves them (API.md, "Integrations").
 *
 * The hub runs the sign-in and keeps the accounts; this file checks what the owner typed against
 * what the vendor's `account.json` asks, seals its secrets before they cross the bus, and hands
 * each step on. What is listed of an account is read here, from the registry, without what it
 * signed in with - `credentials` and `session` never leave the row.
 */
import { eq } from 'drizzle-orm';
import { z } from 'zod';

import {
  accountStepSchema,
  accountSignOutReplySchema,
  busSubjects,
  ConflictError,
  HUB_ACCOUNT_ANSWER_METHOD,
  HUB_ACCOUNT_BEGIN_METHOD,
  HUB_ACCOUNT_POLL_METHOD,
  HUB_ACCOUNT_SIGN_OUT_METHOD,
  HUB_SERVICE,
  NotFoundError,
  secretKeysOf,
  setupValueSchema,
  ValidationError,
  type AccountStatus,
  type AccountStep,
  type IntegrationAccountView,
  type IntegrationVendor,
  type JsonObject,
} from '@nebula-home/contracts';
import { schema, sealSecrets, type Database } from '@nebula-home/db';

import { busOf, listCatalogue, type IntegrationsContext } from './integrations.js';

/**
 * How long a sign-in step may take across the bus: the hub gives the cloud a minute, and this
 * waits a little longer so the hub's own answer - a failure in words - arrives first.
 */
const STEP_TIMEOUT_MS = 65_000;

/** What starting a sign-in takes. */
export const accountBeginBodySchema = z.object({ values: z.record(z.string(), z.unknown()) });

/** What answering a sign-in's question takes. */
export const accountAnswerBodySchema = z.object({ answers: z.record(z.string(), z.unknown()) });

/**
 * Every account of every vendor, or of one, as the vendor's page lists them.
 *
 * @param db - The database.
 * @param vendorId - Only this vendor's, when given.
 * @returns The accounts, in the order they were made.
 */
export async function listAccountViews(
  db: Database,
  vendorId?: string,
): Promise<IntegrationAccountView[]> {
  const accounts = schema.registry.integrationAccounts;
  const query = db
    .select({
      vendorId: accounts.vendorId,
      id: accounts.id,
      label: accounts.label,
      status: accounts.status,
      lastError: accounts.lastError,
      connectedAt: accounts.connectedAt,
      updatedAt: accounts.updatedAt,
    })
    .from(accounts);
  const rows = await (vendorId === undefined
    ? query.orderBy(accounts.createdAt)
    : query.where(eq(accounts.vendorId, vendorId)).orderBy(accounts.createdAt));

  return rows.map((row) => ({ ...row, status: row.status as AccountStatus }));
}

/**
 * Refuses to add a device of a vendor whose account nobody signed in to.
 *
 * @param context - The request's collaborators.
 * @param vendor - The vendor.
 * @returns Once it is known the vendor needs no account, or has one signed in.
 * @throws {ConflictError} `needs-account`, when it has an account and none is signed in.
 */
export async function requireVendorAccount(
  context: IntegrationsContext,
  vendor: IntegrationVendor,
): Promise<void> {
  if (vendor.account === null) {
    return;
  }

  const accounts = await listAccountViews(context.db, vendor.id);

  if (!accounts.some((account) => account.status === 'connected')) {
    throw new ConflictError(`Sign in to a ${vendor.account.name} first`, {
      details: { vendorId: vendor.id, reason: 'needs-account' },
    });
  }
}

/**
 * The vendor, when it has an account.
 *
 * @param context - The request's collaborators.
 * @param vendorId - Which vendor.
 * @returns It, and what its account asks.
 * @throws {NotFoundError} When the hub has no such vendor, or it has no account.
 */
async function vendorWithAccount(
  context: IntegrationsContext,
  vendorId: string,
): Promise<IntegrationVendor & { readonly account: NonNullable<IntegrationVendor['account']> }> {
  const vendor = (await listCatalogue(context)).find((each) => each.id === vendorId);

  if (vendor?.account === null || vendor?.account === undefined) {
    throw new NotFoundError('No integration by that id has an account', {
      details: { vendorId },
    });
  }

  return { ...vendor, account: vendor.account };
}

/**
 * Starts signing in: checks what was typed, seals its secrets, and asks the hub.
 *
 * @param context - The request's collaborators.
 * @param vendorId - Which vendor.
 * @param values - What the owner typed.
 * @returns The first step.
 * @throws {ValidationError} With one issue per field, when the values are not what is asked.
 */
export async function beginSignIn(
  context: IntegrationsContext,
  vendorId: string,
  values: Record<string, unknown>,
): Promise<AccountStep> {
  const vendor = await vendorWithAccount(context, vendorId);
  const group = vendor.account.fields;
  const checked = setupValueSchema(group, 'complete').safeParse(values);

  if (!checked.success) {
    throw new ValidationError('The sign-in is not what the account asks for', {
      details: {
        issues: checked.error.issues.map((issue) => ({
          path: ['values', ...issue.path.map(String)].join('.'),
          message: issue.message,
        })),
      },
    });
  }

  const sealed = sealSecrets(
    { ...group.constants, ...checked.data },
    secretKeysOf(group),
    context.secretsKey,
  );

  return busOf(context).request(
    busSubjects.service(HUB_SERVICE, HUB_ACCOUNT_BEGIN_METHOD),
    { vendorId, values: sealed },
    accountStepSchema,
    { traceId: context.traceId, timeoutMs: STEP_TIMEOUT_MS },
  );
}

/**
 * Carries a sign-in on with the answers to its question.
 *
 * @param context - The request's collaborators.
 * @param flowId - The flow.
 * @param answers - What the owner answered.
 * @returns The next step.
 */
export async function answerSignIn(
  context: IntegrationsContext,
  flowId: string,
  answers: Record<string, unknown>,
): Promise<AccountStep> {
  return busOf(context).request(
    busSubjects.service(HUB_SERVICE, HUB_ACCOUNT_ANSWER_METHOD),
    { flowId, answers: answers as JsonObject },
    accountStepSchema,
    { traceId: context.traceId, timeoutMs: STEP_TIMEOUT_MS },
  );
}

/**
 * Asks whether the page a sign-in sent the owner to was approved.
 *
 * @param context - The request's collaborators.
 * @param flowId - The flow.
 * @returns The next step.
 */
export async function pollSignIn(
  context: IntegrationsContext,
  flowId: string,
): Promise<AccountStep> {
  return busOf(context).request(
    busSubjects.service(HUB_SERVICE, HUB_ACCOUNT_POLL_METHOD),
    { flowId },
    accountStepSchema,
    { traceId: context.traceId, timeoutMs: STEP_TIMEOUT_MS },
  );
}

/**
 * Forgets an account. Its devices stay, unreachable, until they are removed or the account is
 * signed in to again: removing them is the interface's to ask, one by one, as any removal is.
 *
 * @param context - The request's collaborators.
 * @param vendorId - Which vendor.
 * @param accountId - Which account.
 * @returns Whether it was there.
 */
export async function signOutAccount(
  context: IntegrationsContext,
  vendorId: string,
  accountId: string,
): Promise<boolean> {
  const reply = await busOf(context).request(
    busSubjects.service(HUB_SERVICE, HUB_ACCOUNT_SIGN_OUT_METHOD),
    { vendorId, accountId },
    accountSignOutReplySchema,
    { traceId: context.traceId, timeoutMs: STEP_TIMEOUT_MS },
  );

  return reply.wasSignedIn;
}
