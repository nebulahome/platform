/**
 * The pictures image entities show, as their integrations last drew them (ARCHITECTURE.md 8.2).
 *
 * An integration's report of an image entity carries the picture beside the state; the state is
 * only which picture it is (`revision`). The picture stops here: it is kept, the latest per
 * entity, and read by `api` over `svc.hub.entity_image` for whoever shows it. What is published is
 * the report without it.
 *
 * **Not more often than the integration said.** A robot's map is drawn again with every position
 * it reports - every second or two while it cleans - and nobody needs each one: a new revision is
 * announced at most once per the entity's `minIntervalMs`, the latest picture always kept, and
 * the one drawn inside the interval announced when it ends. A picture drawn again the same is not
 * announced at all.
 */
import type { BusClient, BusSubscription } from '@nebula-home/bus';
import {
  busSubjects,
  entityImageRequestSchema,
  HUB_ENTITY_IMAGE_METHOD,
  HUB_SERVICE,
  IMAGE_MAXIMUM_BYTES,
  NotFoundError,
  type EntityImageReply,
  type StateReport,
} from '@nebula-home/contracts';
import type { PlatformLogger } from '@nebula-home/logging';
import type { ImageBlob, ReportedState } from '@nebula-home/package-runtime';

/** How often at most an image entity's new picture is announced, when its integration says not. */
const DEFAULT_MIN_INTERVAL_MS = 2000;

/** One picture kept. */
type Kept = {
  readonly contentType: ImageBlob['contentType'];
  readonly revision: string;
  readonly data: Buffer;
};

/** What was last announced of an entity, and a later announcement waiting for its turn. */
type Announced = {
  readonly atMs: number;
  readonly revision: string;
  readonly waiting: NodeJS.Timeout | undefined;
};

/** What the store needs. */
export type ImageStoreOptions = {
  readonly logger: PlatformLogger;

  /** The clock, in milliseconds; the wall clock when not said. */
  readonly now?: () => number;
};

/** The pictures image entities show. */
export class ImageStore {
  readonly #options: ImageStoreOptions;
  readonly #kept = new Map<string, Kept>();
  readonly #announced = new Map<string, Announced>();
  readonly #tooLarge = new Set<string>();

  /**
   * Prepares an empty store.
   *
   * @param options - The logger and the clock.
   */
  public constructor(options: ImageStoreOptions) {
    this.#options = options;
  }

  /**
   * Keeps the pictures of a batch of reports, and says which reports to publish now.
   *
   * @param reports - What an integration reported.
   * @param publish - Publishes one report later, as the instance: for an announcement that had
   *   to wait for its interval.
   * @returns The reports to publish now, without their pictures.
   */
  public take(
    reports: readonly ReportedState[],
    publish: (report: StateReport) => void,
  ): StateReport[] {
    const now: StateReport[] = [];

    for (const report of reports) {
      const { blob, ...plain } = report;

      if (blob === undefined) {
        now.push(plain);
        continue;
      }

      const revision = plain.state.image?.revision;

      if (revision === undefined || !this.#keep(plain.entityId, revision, blob)) {
        continue;
      }

      const announced = this.#announced.get(plain.entityId);

      if (announced?.revision === revision) {
        continue;
      }

      const intervalMs = blob.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS;
      const nowMs = this.#now();

      if (announced?.waiting !== undefined) {
        // A newer picture than the one waiting: it takes the waiting one's turn.
        clearTimeout(announced.waiting);
      }

      if (announced === undefined || announced.atMs + intervalMs <= nowMs) {
        this.#announced.set(plain.entityId, { atMs: nowMs, revision, waiting: undefined });
        now.push(plain);
        continue;
      }

      const waiting = setTimeout(
        () => {
          this.#announced.set(plain.entityId, {
            atMs: this.#now(),
            revision,
            waiting: undefined,
          });
          publish(plain);
        },
        announced.atMs + intervalMs - nowMs,
      );

      waiting.unref();
      this.#announced.set(plain.entityId, { ...announced, waiting });
    }

    return now;
  }

  /**
   * The picture an image entity shows now.
   *
   * @param entityId - The entity.
   * @returns The picture, or undefined before its integration drew one.
   */
  public get(entityId: string): Kept | undefined {
    return this.#kept.get(entityId);
  }

  /**
   * Serves `svc.hub.entity_image`.
   *
   * @param client - The hub's bus client.
   * @returns The subscription.
   */
  public serve(client: BusClient): BusSubscription {
    return client.serve(
      busSubjects.service(HUB_SERVICE, HUB_ENTITY_IMAGE_METHOD),
      entityImageRequestSchema,

      /**
       * Answers with the picture an image entity shows now.
       *
       * @param request - Which entity.
       * @returns The picture, in base64.
       * @throws {NotFoundError} When there is no picture of it.
       */
      (request): EntityImageReply => {
        const kept = this.#kept.get(request.entityId);

        if (kept === undefined) {
          throw new NotFoundError('That entity has drawn no picture', {
            details: { entityId: request.entityId },
          });
        }

        return {
          contentType: kept.contentType,
          revision: kept.revision,
          data: kept.data.toString('base64'),
        };
      },
    );
  }

  /** Lets go of every waiting announcement. */
  public stop(): void {
    for (const announced of this.#announced.values()) {
      if (announced.waiting !== undefined) {
        clearTimeout(announced.waiting);
      }
    }

    this.#announced.clear();
  }

  /**
   * Keeps one picture, when it is not too large.
   *
   * @param entityId - Its entity.
   * @param revision - Which picture it is.
   * @param blob - The picture.
   * @returns Whether it was kept.
   */
  #keep(entityId: string, revision: string, blob: ImageBlob): boolean {
    const data = typeof blob.data === 'string' ? Buffer.from(blob.data, 'utf8') : blob.data;

    if (data.length > IMAGE_MAXIMUM_BYTES) {
      if (!this.#tooLarge.has(entityId)) {
        this.#tooLarge.add(entityId);
        this.#options.logger.warn(
          { entityId, bytes: data.length, maximum: IMAGE_MAXIMUM_BYTES },
          'An integration drew a picture too large to keep',
        );
      }

      return false;
    }

    this.#kept.set(entityId, { contentType: blob.contentType, revision, data });

    return true;
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
