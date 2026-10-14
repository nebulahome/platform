/**
 * An account a vendor's devices are reached through - a cloud, an app's - and how signing in to
 * it goes.
 *
 * Two halves, as everything a bundle ships is:
 *
 * - **`account.json`**, declarative: what the account is called, what signing in asks - the
 *   fields of a setup group, secrets and all - which field names it on its card, and the module
 *   that signs in. The catalogue serves it, the interface builds its form from it, and `api`
 *   checks what was typed against it before the hub is asked anything.
 * - **the module**, code, written with {@link defineAccount}: what the cloud is asked, step by
 *   step. Signing in is a flow because the cloud decides how it goes - it may answer at once, ask
 *   for a code it emailed, or send the owner to a page of its own to approve - so each call
 *   answers a {@link AccountModuleStep}: connected, with the session to keep; a question; a page
 *   and a code; or why it failed.
 *
 * What the module keeps between steps is its own (`pending`); the hub holds it in memory for a
 * quarter of an hour and nowhere else, since it may hold the password. What a finished sign-in
 * keeps - the values typed, sealed, and the session the cloud gave - the hub stores, and hands
 * the vendor's transport and listener as an {@link AccountHandle}, so a restart signs in with the
 * session rather than asking the cloud, and the owner, again.
 */
import { z } from 'zod';

import {
  setupFieldSchema,
  setupGroupSchema,
  type JsonObject,
  type SetupField,
} from '@nebulahome/contracts';

import { bundlePathSchema } from './bundle.js';
import type { BundleSdk } from './sdk.js';

/** The contents of `account.json`. */
export const accountDeclarationSchema = z
  .strictObject({
    /** What the account is called on the vendor's page: `ECOVACS HOME account`. */
    name: z.string().min(1).max(128),

    /** A sentence under it: what the account is, where the owner has one. */
    help: z.string().max(512).optional(),

    /** What signing in asks, as a setup group's fields; a secret is kept sealed. */
    fields: setupGroupSchema,

    /** Which of the fields names the account on its card, masked: `email`. */
    identity: z.string().min(1).max(64),

    /** The module that signs in, relative to the bundle. */
    module: bundlePathSchema,
  })
  .superRefine((declaration, context) => {
    const field = declaration.fields.fields.find((each) => each.key === declaration.identity);

    if (field === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['identity'],
        message: `identity names ${declaration.identity}, which no field is`,
      });
    } else if (field.type === 'secret') {
      context.addIssue({
        code: 'custom',
        path: ['identity'],
        message: `identity names ${declaration.identity}, a secret: an account is named by what may be shown`,
      });
    }
  });

/** The contents of `account.json`. */
export type AccountDeclaration = z.output<typeof accountDeclarationSchema>;

/** Who an account signed in as: the cloud's id for it, and what its card calls it. */
export type AccountIdentity = {
  /** Stable across sign-ins: the account's id at the cloud. What a device remembers. */
  readonly id: string;

  /** What its card calls it: the email it was made with. */
  readonly label: string;
};

/** Where a sign-in stands, as the module answers it. */
export type AccountModuleStep =
  /** Done: who it is, and what to keep - tokens, a user id - for the next start. */
  | {
      readonly kind: 'connected';
      readonly identity: AccountIdentity;
      readonly session: JsonObject;
    }
  /**
   * The cloud wants something more - a code it emailed, a second factor. `pending` is whatever
   * the module needs to carry on; it comes back with the answers.
   */
  | {
      readonly kind: 'ask';
      readonly message: string;
      readonly fields: readonly SetupField[];
      readonly pending: JsonObject;
    }
  /** The owner approves on a page of the cloud's; asked again every `pollMs`. */
  | {
      readonly kind: 'link';
      readonly message: string;
      readonly url: string;
      readonly code?: string;
      readonly pollMs: number;
      readonly pending: JsonObject;
    }
  /** It did not work, and why; `field` is the one to correct, when one is to blame. */
  | { readonly kind: 'failed'; readonly message: string; readonly field?: string };

/** What a sign-in step is handed beside its arguments. */
export type AccountStepContext = {
  /** Ends the step: the owner gave up, or it took too long. */
  readonly signal: AbortSignal;
};

/** What signing in to a vendor's account does, as its module writes it. */
export type AccountModule = {
  /**
   * Signs in with what the owner typed, secrets opened.
   *
   * @returns Where it stands.
   */
  readonly signIn: (values: JsonObject, context: AccountStepContext) => Promise<AccountModuleStep>;

  /**
   * Carries on after a question, with its answers.
   *
   * @returns Where it stands now; the same question again, with why, for a wrong answer.
   */
  readonly answer: (
    pending: JsonObject,
    answers: JsonObject,
    context: AccountStepContext,
  ) => Promise<AccountModuleStep>;

  /**
   * Asks whether the page the owner was sent to was approved.
   *
   * @returns `link` again while it was not.
   */
  readonly poll?: (pending: JsonObject, context: AccountStepContext) => Promise<AccountModuleStep>;

  /**
   * Tells the cloud the account is forgotten, when the cloud has a way to: a token revoked.
   * Failing is not refusing - the account is forgotten here all the same.
   */
  readonly signOut?: (session: JsonObject, context: AccountStepContext) => Promise<void>;
};

/**
 * Declares what signing in to a vendor's account does. The identity function, as
 * `defineTransport` is: what it adds is the type, for a module written in JavaScript.
 *
 * @param module - The steps.
 * @returns The same steps.
 */
export function defineAccount(module: AccountModule): AccountModule {
  return module;
}

/** What an account module default-exports: a function of the SDK. */
export type AccountFactory = (sdk: BundleSdk) => AccountModule;

/**
 * One account signed in to, as a vendor's transport and listener are handed it.
 *
 * `credentials` are what the owner typed, secrets opened - for a module that signs in again with
 * the password when the session expired; `session` is what the last sign-in kept. A transport
 * that finds the session refused signs in again and keeps the new one (`update`); one that cannot
 * - the cloud wants the owner again - says so (`needsSignIn`), and the account's card asks.
 */
export type AccountHandle = {
  readonly id: string;
  readonly label: string;
  readonly status: 'connected' | 'needs-sign-in' | 'failed';
  readonly credentials: JsonObject;
  readonly session: JsonObject;

  /**
   * Keeps a new session - tokens renewed - for this run and the next.
   *
   * @returns Once it is stored.
   */
  readonly update: (session: JsonObject) => Promise<void>;

  /**
   * Says the account needs the owner to sign in again, and why; its devices stop until then.
   *
   * @returns Once it is recorded.
   */
  readonly needsSignIn: (message: string) => Promise<void>;
};

/** The fields a question may ask: the setup grammar's, a handful at most. */
export const accountQuestionFieldsSchema = z.array(setupFieldSchema).min(1).max(8);
