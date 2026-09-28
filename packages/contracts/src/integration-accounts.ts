/**
 * The accounts an integration signs in with: a cloud the vendor's devices are reached through,
 * an app's account they are bound to.
 *
 * A vendor that needs one declares it in its bundle (`account.json`): what signing in asks, and
 * the module that does it. Signing in is a **flow**, not a form, because the cloud decides how it
 * goes: most answer the password at once, some then email a code to type, some send the owner to
 * a page to approve. So the hub answers each request with a step - connected, a question to
 * answer, a page to open and wait on, or why it failed - and the interface shows that step until
 * it is connected. A step that asks is answered under its `flowId`; the flow and what it holds -
 * the password among it - live only in the hub's memory, for a quarter of an hour.
 *
 * A vendor may hold several accounts - two members of a family, each with their own - and each
 * device remembers which it came from. What the interface lists of an account is its name
 * (`label`, the email it was made with), whether it is signed in, and why not; what it signed in
 * with and the session the cloud gave are kept sealed by the hub, and never leave it.
 */
import { z } from 'zod';

import { setupFieldSchema, setupGroupSchema } from './integration-setup.js';
import { jsonObjectSchema } from './json.js';
import { timestampSchema } from './timestamp.js';

/** `svc.hub.account_begin`: sign in to a new account, or again to one that needs it. */
export const HUB_ACCOUNT_BEGIN_METHOD = 'account_begin';

/** `svc.hub.account_answer`: answer the question a flow's step asked. */
export const HUB_ACCOUNT_ANSWER_METHOD = 'account_answer';

/** `svc.hub.account_poll`: ask whether the page a flow sent the owner to was approved. */
export const HUB_ACCOUNT_POLL_METHOD = 'account_poll';

/** `svc.hub.account_sign_out`: forget an account. */
export const HUB_ACCOUNT_SIGN_OUT_METHOD = 'account_sign_out';

/** `svc.hub.accounts`: the accounts of a vendor, as the interface lists them. */
export const HUB_ACCOUNTS_METHOD = 'accounts';

/** Where an account stands. */
export const ACCOUNT_STATUSES = ['connected', 'needs-sign-in', 'failed'] as const;

/** Where an account stands. */
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

/** An account's id: what its cloud calls it, as the module said when it signed in. */
export const accountIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9._@:+-]{1,128}$/, 'Must be the id the account signed in as');

/** What a vendor's bundle says signing in asks, as the catalogue serves it. */
export const vendorAccountSchema = z.object({
  /** What the account is called: `ECOVACS HOME account`. */
  name: z.string().min(1).max(128),

  /** A sentence under it: what it is for, where the owner has one. */
  help: z.string().max(512).optional(),

  /** What signing in asks, in the grammar of a setup group. */
  fields: setupGroupSchema,

  /** Which field names the account on its card, masked: `email`. */
  identity: z.string().min(1).max(64),
});

/** What a vendor's bundle says signing in asks. */
export type VendorAccount = z.output<typeof vendorAccountSchema>;

/** One account, as the interface lists it. */
export const integrationAccountViewSchema = z.object({
  vendorId: z.string().min(1).max(64),
  id: accountIdSchema,

  /** What it is called on its card: the email, as the module gave it. */
  label: z.string().min(1).max(256),
  status: z.enum(ACCOUNT_STATUSES),

  /** Why it is not signed in, or what went wrong last; null while all is well. */
  lastError: z.string().max(1024).nullable(),

  /** When it was last signed in. */
  connectedAt: timestampSchema.nullable(),
  updatedAt: timestampSchema,
});

/** One account, as the interface lists it. */
export type IntegrationAccountView = z.output<typeof integrationAccountViewSchema>;

/**
 * Where a sign-in stands: what the interface shows next.
 *
 * - `connected` - done; the account is listed, and its devices are added.
 * - `ask` - the cloud wants something more: a code it emailed, a second factor. The fields are
 *   the setup grammar's, and the answers go back under `flowId`.
 * - `link` - the owner approves on a page of the cloud's; the interface opens `url`, shows
 *   `code` when there is one, and asks again every `pollMs`.
 * - `failed` - it did not work, and why; `field` names the one to correct, when one is to blame.
 *   The flow is over: signing in starts again from the form.
 */
export const accountStepSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('connected'), account: integrationAccountViewSchema }),
  z.object({
    kind: z.literal('ask'),
    flowId: z.uuid(),
    message: z.string().min(1).max(1024),
    fields: z.array(setupFieldSchema).min(1).max(8),
  }),
  z.object({
    kind: z.literal('link'),
    flowId: z.uuid(),
    message: z.string().min(1).max(1024),
    url: z.url().max(2048),
    code: z.string().max(64).optional(),
    pollMs: z.int().min(1000).max(60_000),
  }),
  z.object({
    kind: z.literal('failed'),
    message: z.string().min(1).max(1024),
    field: z.string().max(64).optional(),
  }),
]);

/** Where a sign-in stands. */
export type AccountStep = z.output<typeof accountStepSchema>;

/** `svc.hub.account_begin`: which vendor, and what the owner typed. */
export const accountBeginRequestSchema = z.strictObject({
  vendorId: z.string().min(1).max(64),

  /** The form's values, checked by `api` against the vendor's fields; secrets sealed. */
  values: jsonObjectSchema,
});

/** `svc.hub.account_begin`. */
export type AccountBeginRequest = z.output<typeof accountBeginRequestSchema>;

/** `svc.hub.account_answer`: which flow, and the answers to what its step asked. */
export const accountAnswerRequestSchema = z.strictObject({
  flowId: z.uuid(),
  answers: jsonObjectSchema,
});

/** `svc.hub.account_answer`. */
export type AccountAnswerRequest = z.output<typeof accountAnswerRequestSchema>;

/** `svc.hub.account_poll`: which flow. */
export const accountPollRequestSchema = z.strictObject({ flowId: z.uuid() });

/** `svc.hub.account_sign_out`: which account of which vendor. */
export const accountSignOutRequestSchema = z.strictObject({
  vendorId: z.string().min(1).max(64),
  accountId: accountIdSchema,
});

/** `svc.hub.account_sign_out`. */
export type AccountSignOutRequest = z.output<typeof accountSignOutRequestSchema>;

/** `svc.hub.accounts`: which vendor. */
export const accountsRequestSchema = z.strictObject({ vendorId: z.string().min(1).max(64) });

/** The reply to `svc.hub.accounts`. */
export const accountsReplySchema = z.object({ items: z.array(integrationAccountViewSchema) });

/** The reply to `svc.hub.account_sign_out`. */
export const accountSignOutReplySchema = z.object({ wasSignedIn: z.boolean() });

/** What the hub announces when a vendor's accounts changed: which vendor. */
export const integrationEventSchema = z.object({ vendorId: z.string().min(1).max(64) });

/** What the hub announces when a vendor's accounts changed. */
export type IntegrationEvent = z.output<typeof integrationEventSchema>;
