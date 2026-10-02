/**
 * Cameras: their live picture, read while somebody watches and relayed as it comes.
 *
 * `api` asks for a camera's stream on behalf of a viewer and keeps asking while the viewer
 * watches; the hub reads the camera through the stream source its profile names - RTSP, a
 * vendor's own socket - and publishes each frame, as bytes, on the camera's frame subject, where
 * `api` relays it to the browser that decodes it. One stream per camera, however many watch it:
 * a second viewer joins the one running, and is sent the last key frame at once so it need not
 * wait for the camera's next. A stream nobody has asked about for a while is closed.
 *
 * A camera that sends stills also gives a still on its own - the last one, or the first of a
 * stream opened for it - which is what a card's thumbnail asks for. One that sends video has no
 * still to give: its picture exists only once the browser has decoded it.
 */
import type { BusClient, BusSubscription } from '@nebulahome/bus';
import {
  busSubjects,
  CAMERA_FRAME_MAXIMUM_BYTES,
  CAMERA_KEEPALIVE_WINDOW_MS,
  cameraKeepaliveRequestSchema,
  cameraOpenRequestSchema,
  cameraSnapshotRequestSchema,
  DeviceUnavailableError,
  encodeCameraFrame,
  HUB_CAMERA_KEEPALIVE_METHOD,
  HUB_CAMERA_OPEN_METHOD,
  HUB_CAMERA_SNAPSHOT_METHOD,
  HUB_SERVICE,
  NotFoundError,
  ValidationError,
  type CameraFrame,
  type CameraKeepaliveReply,
  type CameraOpenReply,
  type CameraSnapshotReply,
  type CameraTrack,
  type EntityId,
  type JsonObject,
} from '@nebulahome/contracts';
import type { PlatformLogger } from '@nebulahome/logging';
import type { Integration, StreamSource } from '@nebulahome/package-runtime';

import type { DeviceBook } from '../domain/devices.js';

/** How long a camera has to say what it sends before an open gives up. */
const OPEN_TIMEOUT_MS = 15_000;

/** How long a still may be before a new one is waited for. */
const STILL_FRESH_MS = 5000;

/** How often streams nobody watches are looked for. */
const SWEEP_MS = 5000;

/** The instance that owns a camera, as far as reading its picture goes. */
export type CameraOwner = {
  readonly integration: Integration;
  readonly book: DeviceBook;
  readonly options: JsonObject;

  /** The instance's transport settings, secrets opened and the vendor's beneath. */
  readonly transportConfig: JsonObject;
};

/** What the cameras need. */
export type CameraServiceOptions = {
  /** Serves the camera methods and publishes the frames. */
  readonly client: BusClient;
  readonly logger: PlatformLogger;

  /**
   * Finds a stream source by its id.
   *
   * @param id - `<vendor>/<name>`.
   * @returns The source, or undefined when no vendor ships it.
   */
  readonly sourceOf: (id: string) => StreamSource | undefined;

  /**
   * Finds the running instance that owns an entity.
   *
   * @param entityId - The entity.
   * @returns Its owner, or undefined when no running instance does.
   */
  readonly ownerOf: (entityId: EntityId) => CameraOwner | undefined;

  /** The clock, in milliseconds; the wall clock when not said. */
  readonly now?: () => number;
};

/** One camera being read. */
type Stream = {
  readonly abort: AbortController;

  /** Settles with what it sends once the source said; rejects when it failed before. */
  readonly track: Promise<CameraTrack>;

  /** Until when somebody is taken to be watching. */
  deadlineMs: number;

  /** The last key frame, sent at once to a viewer who joins. */
  lastKey: CameraFrame | undefined;

  /** The last still, and when it came. */
  lastJpeg: { readonly data: Uint8Array; readonly atMs: number } | undefined;

  /** Those waiting for the next still. */
  readonly waitingForStill: Set<(still: Uint8Array) => void>;
};

/** Reads cameras while they are watched. */
export class CameraService {
  readonly #options: CameraServiceOptions;
  readonly #streams = new Map<EntityId, Stream>();
  #sweeper: NodeJS.Timeout | undefined;

  /**
   * Prepares the cameras without reading any.
   *
   * @param options - Its collaborators.
   */
  public constructor(options: CameraServiceOptions) {
    this.#options = options;
  }

  /**
   * Serves the three camera methods, and starts looking for streams nobody watches.
   *
   * @returns The subscriptions, to unsubscribe on shutdown.
   */
  public serve(): BusSubscription[] {
    const { client } = this.#options;

    this.#sweeper = setInterval(() => {
      this.#sweep();
    }, SWEEP_MS);
    this.#sweeper.unref();

    return [
      client.serve(
        busSubjects.service(HUB_SERVICE, HUB_CAMERA_OPEN_METHOD),
        cameraOpenRequestSchema,
        async (request): Promise<CameraOpenReply> => ({ track: await this.open(request.entityId) }),
        // Each open waits on its own camera; one slow to answer must not hold up the others.
        { concurrency: 8 },
      ),
      client.serve(
        busSubjects.service(HUB_SERVICE, HUB_CAMERA_KEEPALIVE_METHOD),
        cameraKeepaliveRequestSchema,
        (request): CameraKeepaliveReply => ({ isOpen: this.keepalive(request.entityId) }),
      ),
      client.serve(
        busSubjects.service(HUB_SERVICE, HUB_CAMERA_SNAPSHOT_METHOD),
        cameraSnapshotRequestSchema,
        async (request): Promise<CameraSnapshotReply> => this.snapshot(request.entityId),
        { concurrency: 4 },
      ),
    ];
  }

  /**
   * Stops every stream.
   */
  public stop(): void {
    clearInterval(this.#sweeper);

    for (const stream of this.#streams.values()) {
      stream.abort.abort();
    }

    this.#streams.clear();
  }

  /**
   * Opens a camera's stream, or joins the one running, and says what it sends.
   *
   * @param entityId - The camera.
   * @returns What the stream carries.
   * @throws {NotFoundError} When no running instance owns the entity, or its source is not loaded.
   * @throws {ValidationError} When the entity has no stream.
   * @throws {DeviceUnavailableError} When the camera did not say what it sends in time, or
   * refused.
   */
  public async open(entityId: EntityId): Promise<CameraTrack> {
    const running = this.#streams.get(entityId);

    if (running !== undefined) {
      running.deadlineMs = this.#now() + CAMERA_KEEPALIVE_WINDOW_MS;

      const track = await running.track;
      const key = running.lastKey;

      // After the reply, so the viewer who asked is listening: the last key frame at once.
      if (key !== undefined) {
        setTimeout(() => {
          this.#publish(entityId, key);
        }, 50).unref();
      }

      return track;
    }

    const stream = this.#start(entityId);

    return stream.track;
  }

  /**
   * Says a viewer is still watching.
   *
   * @param entityId - The camera.
   * @returns Whether its stream is still running.
   */
  public keepalive(entityId: EntityId): boolean {
    const stream = this.#streams.get(entityId);

    if (stream === undefined) {
      return false;
    }

    stream.deadlineMs = this.#now() + CAMERA_KEEPALIVE_WINDOW_MS;

    return true;
  }

  /**
   * Takes a still: the last one when it is fresh, the next one otherwise.
   *
   * @param entityId - The camera.
   * @returns The still, as base64 JPEG.
   * @throws {ValidationError} When the camera sends video, which only the browser decodes.
   * @throws {DeviceUnavailableError} When no still came in time.
   */
  public async snapshot(entityId: EntityId): Promise<CameraSnapshotReply> {
    const track = await this.open(entityId);

    if (track.kind !== 'jpeg') {
      throw new ValidationError(
        `${entityId} sends video; its picture is drawn by the browser that plays it`,
        { details: { entityId } },
      );
    }

    const stream = this.#streams.get(entityId);

    if (stream === undefined) {
      throw new DeviceUnavailableError(`${entityId} stopped streaming`, { details: { entityId } });
    }

    const nowMs = this.#now();
    const still =
      stream.lastJpeg !== undefined && nowMs - stream.lastJpeg.atMs < STILL_FRESH_MS
        ? stream.lastJpeg.data
        : await new Promise<Uint8Array>((resolve, reject) => {
            const timer = setTimeout(() => {
              stream.waitingForStill.delete(take);
              reject(
                new DeviceUnavailableError(`${entityId} sent no still in time`, {
                  details: { entityId },
                }),
              );
            }, OPEN_TIMEOUT_MS);

            /**
             * Takes the next still.
             *
             * @param data - The still.
             */
            const take = (data: Uint8Array): void => {
              clearTimeout(timer);
              resolve(data);
            };

            stream.waitingForStill.add(take);
          });

    return { jpeg: Buffer.from(still).toString('base64'), capturedAt: new Date() };
  }

  /**
   * Starts reading a camera.
   *
   * @param entityId - The camera.
   * @returns The stream, its track still to come.
   * @throws {NotFoundError} When no running instance owns it, or its source is not loaded.
   * @throws {ValidationError} When it has no stream.
   */
  #start(entityId: EntityId): Stream {
    const { logger, ownerOf, sourceOf } = this.#options;
    const owner = ownerOf(entityId);
    const binding = owner?.book.byEntityId(entityId);

    if (owner === undefined || binding === undefined) {
      throw new NotFoundError(`No running device owns ${entityId}`, { details: { entityId } });
    }

    const request = owner.integration.streamOf?.(
      entityId,
      owner.book.contextFor(binding, owner.options),
    );

    if (request === undefined) {
      throw new ValidationError(`${entityId} has no stream`, { details: { entityId } });
    }

    const source = sourceOf(request.source);

    if (source === undefined) {
      throw new NotFoundError(`No bundle ships the stream source ${request.source}`, {
        details: { entityId, source: request.source },
      });
    }

    const abort = new AbortController();
    /**
     * Settles the track with what the stream carries: a placeholder until the promise exists.
     *
     * @returns Nothing.
     */
    let describe: (described: CameraTrack) => void = () => undefined;

    /**
     * Fails the track with why the stream did not open: a placeholder until the promise exists.
     *
     * @returns Nothing.
     */
    let fail: (error: Error) => void = () => undefined;
    const track = new Promise<CameraTrack>((resolve, reject) => {
      describe = resolve;
      fail = reject;
    });
    const stream: Stream = {
      abort,
      track,
      deadlineMs: this.#now() + CAMERA_KEEPALIVE_WINDOW_MS,
      lastKey: undefined,
      lastJpeg: undefined,
      waitingForStill: new Set(),
    };
    // Whoever never awaited the track must not see an unhandled rejection.
    track.catch(() => undefined);

    const timer = setTimeout(() => {
      fail(
        new DeviceUnavailableError(`${entityId} did not say what it sends in time`, {
          details: { entityId },
        }),
      );
      this.#end(entityId, stream);
    }, OPEN_TIMEOUT_MS);

    timer.unref();
    this.#streams.set(entityId, stream);

    source
      .open(
        owner.transportConfig,
        request.args,
        {
          /**
           * Takes what the stream carries, which is what opening it waited for.
           *
           * @param described - The track.
           */
          describe: (described) => {
            clearTimeout(timer);
            describe(described);
          },

          /**
           * Carries one frame to whoever watches, and keeps what a newcomer starts from.
           *
           * @param frame - The frame.
           */
          frame: (frame) => {
            if (frame.data.byteLength > CAMERA_FRAME_MAXIMUM_BYTES) {
              logger.debug(
                { entityId, bytes: frame.data.byteLength },
                'A frame too large to carry',
              );

              return;
            }

            if (frame.isKey) {
              stream.lastKey = frame;
            }

            this.#publish(entityId, frame);
            void track.then((carried) => {
              if (carried.kind === 'jpeg') {
                stream.lastJpeg = { data: frame.data, atMs: this.#now() };

                for (const take of stream.waitingForStill) {
                  take(frame.data);
                }

                stream.waitingForStill.clear();
              }
            });
          },
        },
        abort.signal,
      )
      .then(() => {
        fail(new DeviceUnavailableError(`${entityId} ended its stream`, { details: { entityId } }));
      })
      .catch((error: unknown) => {
        if (!abort.signal.aborted) {
          logger.warn({ err: error, entityId }, 'A camera stream failed');
        }

        fail(
          new DeviceUnavailableError(
            `${entityId}: ${error instanceof Error ? error.message : String(error)}`,
            { details: { entityId } },
          ),
        );
      })
      .finally(() => {
        clearTimeout(timer);
        this.#end(entityId, stream);
      });

    logger.info({ entityId, source: request.source }, 'Camera stream opened');

    return stream;
  }

  /**
   * Publishes one frame on the camera's subject.
   *
   * @param entityId - The camera.
   * @param frame - The frame.
   */
  #publish(entityId: EntityId, frame: CameraFrame): void {
    this.#options.client.publishRaw(busSubjects.cameraFrame(entityId), encodeCameraFrame(frame));
  }

  /**
   * Forgets a stream that ended, and stops it if it has not.
   *
   * @param entityId - The camera.
   * @param stream - The stream, so a newer one under the same camera is left alone.
   */
  #end(entityId: EntityId, stream: Stream): void {
    stream.abort.abort();

    if (this.#streams.get(entityId) === stream) {
      this.#streams.delete(entityId);
    }
  }

  /** Stops the streams nobody has asked about within the window. */
  #sweep(): void {
    const nowMs = this.#now();

    for (const [entityId, stream] of this.#streams) {
      if (nowMs > stream.deadlineMs) {
        this.#options.logger.info({ entityId }, 'Camera stream closed: nobody is watching');
        this.#end(entityId, stream);
      }
    }
  }

  /**
   * Reads the clock.
   *
   * @returns Now, in milliseconds.
   */
  #now(): number {
    return (this.#options.now ?? Date.now)();
  }
}
