/**
 * Reporting installs to the Community Hub: how the Hub counts how many houses installed a package
 * or an integration (the Hub's ARCHITECTURE.md 10).
 *
 * The house registers once per Hub, the first time it has something to report: a proof of work,
 * then a token the Hub shows that once, kept sealed in `system.community_hub_installations` and
 * sent with every report after - one token for the whole house, whatever it installs. Only
 * releases of the index are reported, an install or an update each; a file of the local folder,
 * a reinstall of the same version and anything installed while reports are off are not.
 *
 * Reports are best-effort and never hold an install up: events wait in memory and go in batches a
 * moment later, again a minute later when the Hub cannot be reached, and a token the Hub refuses -
 * revoked, or a Hub whose database was emptied - is forgotten and the house registers again. A
 * report lost to a restart only makes the Hub's count one smaller.
 */
import { openSecret, sealSecret } from '@nebulahome/db';
import type { PlatformLogger } from '@nebulahome/logging';

import type { HubInstallationStore } from '../persistence/hub-installations.js';

import type { CommunityHubClient, HubInstallEvent } from './hub-client.js';
import { solveChallenge } from './proof-of-work.js';

/** How long after an install its report goes: the next install of a plan joins the batch. */
const BATCH_DELAY_MS = 2000;

/** How long before a report the Hub could not take is tried again. */
const RETRY_MS = 60_000;

/** The most events one report carries, as the Hub takes them. */
const BATCH_LIMIT = 100;

/** The most events kept waiting: past it, the oldest are dropped. */
const QUEUE_LIMIT = 1000;

/** What reports an install: the reporter, or nothing in a test. */
export type InstallReporter = {
  readonly report: (event: HubInstallEvent) => void;
};

/** What the reporter needs. */
export type HubReporterOptions = {
  readonly hub: CommunityHubClient;
  readonly store: HubInstallationStore;
  readonly secretsKey: Buffer;

  /** This platform's release, which the Hub records at registration. */
  readonly platformVersion: string;
  readonly logger: PlatformLogger;

  /** Whether reports are sent at all: `COMMUNITY_HUB_REPORT_INSTALLS`. */
  readonly isEnabled: boolean;

  /** How long a batch waits, and a failed one before it is tried again; for a test. */
  readonly batchDelayMs?: number;
  readonly retryMs?: number;
};

/** The house's install reports, sent in batches. */
export class HubReporter implements InstallReporter {
  readonly #options: HubReporterOptions;
  readonly #queue: HubInstallEvent[] = [];
  readonly #abort = new AbortController();
  #timer: NodeJS.Timeout | undefined;
  #flushing: Promise<void> | undefined;

  /**
   * Makes a reporter that holds nothing yet.
   *
   * @param options - The Hub, where the token is kept, the key that seals it.
   */
  public constructor(options: HubReporterOptions) {
    this.#options = options;
  }

  /**
   * Reports an install, a moment later with whatever joins it.
   *
   * @param event - What was installed or updated.
   */
  public report(event: HubInstallEvent): void {
    if (!this.#options.isEnabled || this.#options.hub.url === undefined) {
      return;
    }

    this.#queue.push(event);

    if (this.#queue.length > QUEUE_LIMIT) {
      this.#queue.splice(0, this.#queue.length - QUEUE_LIMIT);
    }

    this.#schedule(this.#options.batchDelayMs ?? BATCH_DELAY_MS);
  }

  /**
   * Sends what waits now, rather than when its timer fires; for a test and for shutdown.
   *
   * @returns Once the attempt is over, whatever came of it.
   */
  public async flush(): Promise<void> {
    clearTimeout(this.#timer);
    this.#timer = undefined;
    this.#flushing ??= this.#send().finally(() => {
      this.#flushing = undefined;
    });

    await this.#flushing;
  }

  /** Stops sending: what waits is dropped, and a proof of work under way is given up. */
  public stop(): void {
    clearTimeout(this.#timer);
    this.#timer = undefined;
    this.#abort.abort();
    this.#queue.length = 0;
  }

  /**
   * Sends what waits after a delay, unless a send is already due sooner.
   *
   * @param delayMs - How long to wait.
   */
  #schedule(delayMs: number): void {
    if (this.#timer !== undefined || this.#abort.signal.aborted) {
      return;
    }

    this.#timer = setTimeout(() => {
      this.#timer = undefined;
      void this.flush();
    }, delayMs);
    this.#timer.unref();
  }

  /**
   * Sends every waiting event, a batch at a time, registering the house first if it must.
   *
   * @returns Once they are sent, or the attempt failed and another is scheduled.
   */
  async #send(): Promise<void> {
    const { hub, logger } = this.#options;
    let isRenewed = false;

    while (this.#queue.length > 0 && !this.#isStopped()) {
      const batch = this.#queue.slice(0, BATCH_LIMIT);

      try {
        // One batch after another: a refused token is renewed before the next goes.
        // eslint-disable-next-line no-await-in-loop -- see above
        const token = await this.#token();
        // eslint-disable-next-line no-await-in-loop -- see above
        const outcome = await hub.reportInstalls(token, batch);

        if (outcome === 'token-refused') {
          // eslint-disable-next-line no-await-in-loop -- see above
          await this.#options.store.remove(hub.url ?? '');

          // Once per attempt: a house the Hub blocks is refused again, and waits for the retry.
          if (isRenewed) {
            throw new Error('The Community Hub refused the house again after it registered');
          }

          logger.warn({ hub: hub.url }, 'The Community Hub refused the house: registering again');
          isRenewed = true;
          continue;
        }

        this.#queue.splice(0, batch.length);
        logger.debug({ events: batch.length }, 'Reported installs to the Community Hub');
      } catch (error: unknown) {
        if (this.#isStopped()) {
          return;
        }

        logger.warn(
          { err: error, events: this.#queue.length },
          'Could not report installs to the Community Hub; trying again in a minute',
        );
        this.#schedule(this.#options.retryMs ?? RETRY_MS);

        return;
      }
    }
  }

  /**
   * Says whether the reporter was stopped, as it stands now rather than when a loop began.
   *
   * @returns True once {@link stop} ran.
   */
  #isStopped(): boolean {
    return this.#abort.signal.aborted;
  }

  /**
   * The house's token at the Hub, registering the house when it has none.
   *
   * @returns The token, in the clear.
   */
  async #token(): Promise<string> {
    const { hub, store, secretsKey, logger } = this.#options;
    const url = hub.url ?? '';
    const known = await store.get(url);

    if (known !== undefined) {
      return openSecret(known.token, secretsKey);
    }

    const { challenge, difficultyBits } = await hub.challenge();
    const solution = await solveChallenge(challenge, difficultyBits, this.#abort.signal);
    const registered = await hub.register({
      challenge,
      solution,
      platformVersion: this.#options.platformVersion,
    });

    await store.save({
      hubUrl: url,
      installationId: registered.id,
      token: sealSecret(registered.token, secretsKey),
    });
    logger.info(
      { hub: url, installation: registered.id },
      'Registered the house at the Community Hub',
    );

    return registered.token;
  }
}
