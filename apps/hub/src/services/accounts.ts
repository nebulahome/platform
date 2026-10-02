/**
 * Signing in to the accounts a vendor's devices are reached through (ARCHITECTURE.md 8.2).
 *
 * The vendor's bundle says what signing in asks (`account.json`) and ships the module that does
 * it; this service runs the module one step at a time, for `api`, and keeps what comes of it.
 *
 * **A flow is a conversation.** `begin` hands the module what the owner typed; the module answers
 * a step - connected, a question, a page to approve on, or why it failed - and a step that waits
 * on the owner is kept here under a `flowId`, with what the module needs to carry on and what the
 * owner typed. Nothing of it is written anywhere: it may hold the password, and a quarter of an
 * hour is longer than anybody takes to read an email and type a code.
 *
 * **An account signed in is kept** - the values typed, sealed by `api`, and the session the
 * cloud gave, sealed here - so a restart signs in with the session and does not ask the cloud,
 * and the owner, again. Its transport is handed it as an {@link AccountHandle}: a renewed session
 * is kept with `update`, and one the cloud refuses for good becomes `needs-sign-in` with
 * `needsSignIn`, which the account's card shows.
 *
 * Whatever changes an account - signed in, out, asked to sign in again - is announced
 * (`event.integration.changed`), and one signed in or out restarts the vendor's instances and
 * asks its listener to look now, so the devices on an account appear the moment it is connected.
 */
import { randomUUID } from 'node:crypto';

import type { BusClient, BusSubscription } from '@nebulahome/bus';
import {
  accountAnswerRequestSchema,
  accountBeginRequestSchema,
  accountPollRequestSchema,
  accountSignOutRequestSchema,
  accountsReplySchema,
  accountsRequestSchema,
  busSubjects,
  HUB_ACCOUNT_ANSWER_METHOD,
  HUB_ACCOUNT_BEGIN_METHOD,
  HUB_ACCOUNT_POLL_METHOD,
  HUB_ACCOUNT_SIGN_OUT_METHOD,
  HUB_ACCOUNTS_METHOD,
  HUB_SERVICE,
  NotFoundError,
  setupValueSchema,
  ValidationError,
  type AccountStep,
  type IntegrationAccountView,
  type IntegrationEvent,
  type JsonObject,
  type SetupField,
} from '@nebulahome/contracts';
import { openSecrets } from '@nebulahome/db';
import type { PlatformLogger } from '@nebulahome/logging';
import type { AccountHandle, AccountModuleStep } from '@nebulahome/package-runtime';

import { accountViewOf, type AccountStore, type StoredAccount } from '../persistence/accounts.js';

import type { LoadedAccount, LoadedVendor } from './bundles.js';

/** How long a flow waits on the owner before it is forgotten. */
export const FLOW_TTL_MS = 15 * 60_000;

/** How long one step of the module may take. */
const STEP_TIMEOUT_MS = 60_000;

/** A flow waiting on the owner. */
type Flow = {
  readonly vendorId: string;

  /** What the owner typed at the start, its secrets sealed as `api` sent them. */
  readonly credentials: JsonObject;

  /** What the module keeps between steps. */
  readonly pending: JsonObject;

  /** What its last step asked, which the answers are checked against. */
  readonly fields: readonly SetupField[];
  readonly kind: 'ask' | 'link';
  readonly expiresAtMs: number;
};

/** What the service needs. */
export type AccountServiceOptions = {
  readonly client: BusClient;

  /** Where the accounts are kept. */
  readonly store: AccountStore;
  readonly logger: PlatformLogger;

  /** Opens what `api` sealed of what the owner typed. */
  readonly secretsKey: Buffer;

  /**
   * The vendors loaded, read when asked.
   *
   * @returns Every loaded vendor.
   */
  readonly vendors: () => readonly LoadedVendor[];

  /**
   * Called when an account signed in or out: the vendor's instances start again, its listener
   * looks now.
   *
   * @param vendorId - The vendor.
   * @returns Once it is done.
   */
  readonly onSignedInOrOut: (vendorId: string) => Promise<void>;

  /** The clock, in milliseconds; the wall clock when not said. */
  readonly now?: () => number;
};

/** Runs sign-ins and keeps the accounts. */
export class AccountService {
  readonly #options: AccountServiceOptions;
  readonly #flows = new Map<string, Flow>();

  /**
   * Prepares the service without serving anything.
   *
   * @param options - Its collaborators.
   */
  public constructor(options: AccountServiceOptions) {
    this.#options = options;
  }

  /**
   * Serves the account subjects.
   *
   * @returns The subscriptions, to end on shutdown.
   */
  public serve(): BusSubscription[] {
    const { client } = this.#options;
    /**
     * The subject of one of the hub's account methods.
     *
     * @param method - The method.
     * @returns Its subject.
     */
    const subject = (method: string): string => busSubjects.service(HUB_SERVICE, method);

    return [
      client.serve(
        subject(HUB_ACCOUNT_BEGIN_METHOD),
        accountBeginRequestSchema,
        /**
         * Signs in with what the owner typed.
         *
         * @param request - Which vendor, and the values.
         * @returns The first step.
         */
        async (request): Promise<AccountStep> => this.begin(request.vendorId, request.values),
        { concurrency: 4 },
      ),
      client.serve(
        subject(HUB_ACCOUNT_ANSWER_METHOD),
        accountAnswerRequestSchema,
        /**
         * Answers a question.
         *
         * @param request - Which flow, and the answers.
         * @returns The next step.
         */
        async (request): Promise<AccountStep> => this.answer(request.flowId, request.answers),
        { concurrency: 4 },
      ),
      client.serve(
        subject(HUB_ACCOUNT_POLL_METHOD),
        accountPollRequestSchema,
        /**
         * Asks whether the owner approved.
         *
         * @param request - Which flow.
         * @returns The next step.
         */
        async (request): Promise<AccountStep> => this.poll(request.flowId),
        { concurrency: 4 },
      ),
      client.serve(
        subject(HUB_ACCOUNT_SIGN_OUT_METHOD),
        accountSignOutRequestSchema,
        /**
         * Forgets an account.
         *
         * @param request - Which account of which vendor.
         * @returns Whether it was there.
         */
        async (request): Promise<{ wasSignedIn: boolean }> => ({
          wasSignedIn: await this.signOut(request.vendorId, request.accountId),
        }),
      ),
      client.serve(
        subject(HUB_ACCOUNTS_METHOD),
        accountsRequestSchema,
        /**
         * Lists a vendor's accounts.
         *
         * @param request - Which vendor.
         * @returns Its accounts.
         */
        async (request) => accountsReplySchema.parse({ items: await this.list(request.vendorId) }),
      ),
    ];
  }

  /**
   * A vendor's accounts, as the interface lists them.
   *
   * @param vendorId - The vendor.
   * @returns Its accounts.
   */
  public async list(vendorId: string): Promise<IntegrationAccountView[]> {
    return (await this.#load(vendorId)).map(accountViewOf);
  }

  /**
   * Every account of a vendor signed in to, as its listener is handed them.
   *
   * @param vendorId - The vendor.
   * @returns The accounts; those that need signing in again are left out.
   */
  public async handlesOf(vendorId: string): Promise<AccountHandle[]> {
    return (await this.#load(vendorId))
      .filter((account) => account.status === 'connected')
      .map((account) => this.#handleOf(account));
  }

  /**
   * One account, as a transport is handed it.
   *
   * @param vendorId - The vendor.
   * @param accountId - The account.
   * @returns It, or undefined when there is no such account.
   */
  public async handleFor(vendorId: string, accountId: string): Promise<AccountHandle | undefined> {
    const account = (await this.#load(vendorId)).find((each) => each.id === accountId);

    return account === undefined ? undefined : this.#handleOf(account);
  }

  /**
   * Signs in with what the owner typed.
   *
   * @param vendorId - The vendor.
   * @param values - The form's values, checked by `api`, secrets sealed.
   * @returns The first step.
   * @throws {NotFoundError} When the vendor is not loaded or has no account.
   */
  public async begin(vendorId: string, values: JsonObject): Promise<AccountStep> {
    const account = this.#accountOf(vendorId);
    const opened = openSecrets(values, this.#options.secretsKey);
    const step = await this.#step(vendorId, async (signal) =>
      account.module.signIn(opened, { signal }),
    );

    return this.#after(vendorId, values, step);
  }

  /**
   * Carries a flow on with the answers to its question.
   *
   * @param flowId - The flow.
   * @param answers - What the owner answered.
   * @returns The next step.
   * @throws {NotFoundError} When the flow is not there - over, or forgotten.
   * @throws {ValidationError} When the answers are not what the question asked.
   */
  public async answer(flowId: string, answers: JsonObject): Promise<AccountStep> {
    const flow = this.#flowOf(flowId);
    const checked = setupValueSchema(
      { constants: {}, fields: [...flow.fields] },
      'complete',
    ).safeParse(answers);

    if (!checked.success) {
      throw new ValidationError('The answers are not what the sign-in asked', {
        details: {
          issues: checked.error.issues.map((issue) => ({
            path: ['answers', ...issue.path.map(String)].join('.'),
            message: issue.message,
          })),
        },
      });
    }

    this.#flows.delete(flowId);

    const account = this.#accountOf(flow.vendorId);
    const step = await this.#step(flow.vendorId, async (signal) =>
      account.module.answer(flow.pending, checked.data, { signal }),
    );

    return this.#after(flow.vendorId, flow.credentials, step);
  }

  /**
   * Asks whether the page a flow sent the owner to was approved.
   *
   * @param flowId - The flow.
   * @returns The next step: `link` again while it was not.
   * @throws {NotFoundError} When the flow is not there, or is not waiting on a page.
   */
  public async poll(flowId: string): Promise<AccountStep> {
    const flow = this.#flowOf(flowId);
    const account = this.#accountOf(flow.vendorId);
    const { poll } = account.module;

    if (flow.kind !== 'link' || poll === undefined) {
      throw new NotFoundError('That sign-in is not waiting on a page', { details: { flowId } });
    }

    this.#flows.delete(flowId);

    const step = await this.#step(flow.vendorId, async (signal) => poll(flow.pending, { signal }));

    return this.#after(flow.vendorId, flow.credentials, step);
  }

  /**
   * Forgets an account, telling its cloud when the module can.
   *
   * @param vendorId - The vendor.
   * @param accountId - The account.
   * @returns Whether it was there.
   */
  public async signOut(vendorId: string, accountId: string): Promise<boolean> {
    const stored = (await this.#load(vendorId)).find((each) => each.id === accountId);

    if (stored === undefined) {
      return false;
    }

    const signOut = this.#vendorOf(vendorId)?.account?.module.signOut;

    if (signOut !== undefined) {
      try {
        await signOut(stored.session, { signal: AbortSignal.timeout(STEP_TIMEOUT_MS) });
      } catch (error: unknown) {
        // Forgotten here all the same: the cloud's token lapses on its own.
        this.#options.logger.warn(
          { err: error, vendor: vendorId },
          'Signing out at the cloud failed',
        );
      }
    }

    const wasThere = await this.#options.store.delete(vendorId, accountId);

    this.#announce(vendorId);
    await this.#options.onSignedInOrOut(vendorId);

    return wasThere;
  }

  /**
   * Runs one step of the module, within its time.
   *
   * @param vendorId - The vendor, for the log.
   * @param run - The step.
   * @returns What it answered; a failure, in words, when it threw.
   */
  async #step(
    vendorId: string,
    run: (signal: AbortSignal) => Promise<AccountModuleStep>,
  ): Promise<AccountModuleStep> {
    try {
      return await run(AbortSignal.timeout(STEP_TIMEOUT_MS));
    } catch (error: unknown) {
      this.#options.logger.warn({ err: error, vendor: vendorId }, 'A sign-in step failed');

      return {
        kind: 'failed',
        message: error instanceof Error ? error.message : 'The sign-in failed',
      };
    }
  }

  /**
   * Turns what the module answered into what the interface is told, keeping what comes of it.
   *
   * @param vendorId - The vendor.
   * @param credentials - What the owner typed at the start, sealed.
   * @param step - What the module answered.
   * @returns The step, as the interface shows it.
   */
  async #after(
    vendorId: string,
    credentials: JsonObject,
    step: AccountModuleStep,
  ): Promise<AccountStep> {
    this.#forgetExpired();

    switch (step.kind) {
      case 'connected': {
        const stored = await this.#options.store.saveSignedIn({
          vendorId,
          id: step.identity.id,
          label: step.identity.label,
          credentials,
          session: step.session,
        });

        this.#announce(vendorId);
        await this.#options.onSignedInOrOut(vendorId);

        return { kind: 'connected', account: accountViewOf(stored) };
      }

      case 'ask': {
        const flowId = this.#keep(vendorId, credentials, step.pending, step.fields, 'ask');

        return { kind: 'ask', flowId, message: step.message, fields: [...step.fields] };
      }

      case 'link': {
        const flowId = this.#keep(vendorId, credentials, step.pending, [], 'link');

        return {
          kind: 'link',
          flowId,
          message: step.message,
          url: step.url,
          ...(step.code === undefined ? {} : { code: step.code }),
          pollMs: Math.min(60_000, Math.max(1000, step.pollMs)),
        };
      }

      case 'failed': {
        return {
          kind: 'failed',
          message: step.message.slice(0, 1024),
          ...(step.field === undefined ? {} : { field: step.field }),
        };
      }
    }
  }

  /**
   * Keeps a flow that waits on the owner.
   *
   * @param vendorId - The vendor.
   * @param credentials - What the owner typed at the start, sealed.
   * @param pending - What the module keeps between steps.
   * @param fields - What its step asked.
   * @param kind - Whether it asked, or sent the owner to a page.
   * @returns The flow's id.
   */
  #keep(
    vendorId: string,
    credentials: JsonObject,
    pending: JsonObject,
    fields: readonly SetupField[],
    kind: Flow['kind'],
  ): string {
    const flowId = randomUUID();

    this.#flows.set(flowId, {
      vendorId,
      credentials,
      pending,
      fields,
      kind,
      expiresAtMs: this.#now() + FLOW_TTL_MS,
    });

    return flowId;
  }

  /**
   * A flow still waiting.
   *
   * @param flowId - The flow.
   * @returns It.
   * @throws {NotFoundError} When it is over or was forgotten.
   */
  #flowOf(flowId: string): Flow {
    this.#forgetExpired();

    const flow = this.#flows.get(flowId);

    if (flow === undefined) {
      throw new NotFoundError('That sign-in is over: start it again', { details: { flowId } });
    }

    return flow;
  }

  /** Forgets the flows nobody answered in time. */
  #forgetExpired(): void {
    const now = this.#now();

    for (const [flowId, flow] of this.#flows) {
      if (flow.expiresAtMs <= now) {
        this.#flows.delete(flowId);
      }
    }
  }

  /**
   * A loaded vendor.
   *
   * @param vendorId - Which.
   * @returns It, or undefined.
   */
  #vendorOf(vendorId: string): LoadedVendor | undefined {
    return this.#options.vendors().find((vendor) => vendor.manifest.id === vendorId);
  }

  /**
   * A loaded vendor's account.
   *
   * @param vendorId - Which vendor.
   * @returns Its account.
   * @throws {NotFoundError} When the vendor is not loaded, or has no account.
   */
  #accountOf(vendorId: string): LoadedAccount {
    const account = this.#vendorOf(vendorId)?.account;

    if (account === undefined) {
      throw new NotFoundError('No loaded integration has that account', {
        details: { vendorId },
      });
    }

    return account;
  }

  /**
   * Reads a vendor's accounts.
   *
   * @param vendorId - The vendor.
   * @returns Them, secrets opened.
   */
  async #load(vendorId: string): Promise<StoredAccount[]> {
    return this.#options.store.load(vendorId);
  }

  /**
   * One account, as its transport and listener are handed it.
   *
   * @param account - The account.
   * @returns The handle.
   */
  #handleOf(account: StoredAccount): AccountHandle {
    const { store, logger } = this.#options;

    return {
      id: account.id,
      label: account.label,
      status: account.status,
      credentials: openSecrets(account.credentials, this.#options.secretsKey),
      session: account.session,

      /**
       * Keeps a renewed session.
       *
       * @param session - The new session.
       * @returns Once it is stored.
       */
      update: async (session: JsonObject): Promise<void> => {
        await store.saveSession(account.vendorId, account.id, session);

        if (account.status !== 'connected') {
          await store.saveStatus(account.vendorId, account.id, 'connected', null);
          this.#announce(account.vendorId);
        }
      },

      /**
       * Says the owner must sign in again, and why.
       *
       * @param message - Why, for the account's card.
       * @returns Once it is recorded.
       */
      needsSignIn: async (message: string): Promise<void> => {
        logger.warn({ vendor: account.vendorId }, message);

        if (await store.saveStatus(account.vendorId, account.id, 'needs-sign-in', message)) {
          this.#announce(account.vendorId);
        }
      },
    };
  }

  /**
   * Says a vendor's accounts changed, for its page.
   *
   * @param vendorId - The vendor.
   */
  #announce(vendorId: string): void {
    const payload: IntegrationEvent = { vendorId };

    this.#options.client.publish(busSubjects.integrationEvent(), payload);
  }

  /**
   * The time now.
   *
   * @returns Milliseconds since the epoch.
   */
  #now(): number {
    return (this.#options.now ?? Date.now)();
  }
}
