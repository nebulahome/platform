/**
 * Cameras: the live picture over a socket of its own, and a still over HTTP.
 *
 * The browser decodes (camera.ts in the contracts): this relays. A viewer opens a socket for one
 * camera, authenticates with its first message - a token in a URL ends up in logs (RULES.md 16) -
 * and is told what the stream carries, then sent each frame as bytes as the hub publishes it,
 * until it closes the socket. While it is open the hub is told every few seconds that somebody
 * is watching.
 *
 * A viewer that cannot keep up - a phone on a weak link - is not sent everything: frames that
 * would queue behind a full socket are dropped until the next key frame, from which its decoder
 * can start again, rather than piling up in memory for a picture minutes old.
 *
 * Both need to be allowed to read the camera, as reading its state does.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { WebSocket } from 'ws';
import { z } from 'zod';

import {
  busSubjects,
  CAMERA_KEEPALIVE_EVERY_MS,
  cameraKeepaliveReplySchema,
  cameraOpenReplySchema,
  cameraSnapshotReplySchema,
  cameraSocketAuthSchema,
  decodeCameraFrame,
  DeviceUnavailableError,
  entityIdSchema,
  HUB_CAMERA_KEEPALIVE_METHOD,
  HUB_CAMERA_OPEN_METHOD,
  HUB_CAMERA_SNAPSHOT_METHOD,
  HUB_SERVICE,
  NotFoundError,
  WS_AUTH_TIMEOUT_MS,
  WS_CLOSE_TOKEN_EXPIRED,
  WS_CLOSE_UNAUTHENTICATED,
  type CameraSocketMessage,
  type EntityId,
} from '@nebula-home/contracts';

import { verifyAccessToken } from '../auth/tokens.js';
import type { ApiContext } from '../context.js';
import { requireIdentity } from '../http/guard.js';
import { readableEntityIds } from '../services/entities.js';

/** How much may wait in a viewer's socket before frames are dropped. */
const MAXIMUM_BUFFERED_BYTES = 4 * 1024 * 1024;

/** How long the hub has to start a stream: a camera may take seconds to say what it sends. */
const OPEN_TIMEOUT_MS = 20_000;

/** The close code for a stream that could not be had. */
const WS_CLOSE_UNAVAILABLE = 4404;

/** The camera, in the path. */
const cameraParamsSchema = z.object({ entityId: entityIdSchema });

/**
 * Registers the camera routes.
 *
 * @param server - The server, with the websocket plugin applied.
 * @param context - The service's collaborators.
 * @param basePath - The versioned prefix every route sits under.
 */
export function registerCameraRoutes(
  server: FastifyInstance,
  context: ApiContext,
  basePath: string,
): void {
  server.get(
    `${basePath}/entities/:entityId/camera/snapshot`,

    /**
     * Serves a still from a camera that sends stills.
     *
     * @param request - Which camera, and who is asking.
     * @param reply - Where the picture goes.
     * @returns The JPEG.
     */
    async (request: FastifyRequest, reply: FastifyReply): Promise<Buffer> => {
      const identity = requireIdentity(request);
      const { entityId } = cameraParamsSchema.parse(request.params);

      if (!(await readableEntityIds(context.db, identity)).has(entityId)) {
        throw new NotFoundError('No entity has that id', { details: { entityId } });
      }

      if (context.bus === undefined) {
        throw new DeviceUnavailableError('The hub cannot be reached', { details: { entityId } });
      }

      const still = await context.bus.request(
        busSubjects.service(HUB_SERVICE, HUB_CAMERA_SNAPSHOT_METHOD),
        { entityId },
        cameraSnapshotReplySchema,
        { timeoutMs: OPEN_TIMEOUT_MS },
      );

      void reply.type('image/jpeg').header('cache-control', 'no-store');

      return Buffer.from(still.jpeg, 'base64');
    },
  );

  server.get(
    `${basePath}/cameras/:entityId/live`,
    { websocket: true },

    /**
     * Relays one camera to one viewer for as long as the socket is open.
     *
     * @param socket - The viewer's socket.
     * @param request - The upgrade request.
     */
    (socket: WebSocket, request: FastifyRequest): void => {
      const params = cameraParamsSchema.safeParse(request.params);
      const cleanup: (() => void)[] = [];
      let isAuthenticated = false;

      /**
       * Says something to the viewer.
       *
       * @param message - What.
       */
      const say = (message: CameraSocketMessage): void => {
        if (socket.readyState === socket.OPEN) {
          socket.send(JSON.stringify(message));
        }
      };

      /**
       * Ends the socket with a reason.
       *
       * @param code - The close code.
       * @param message - The reason.
       */
      const refuse = (code: number, message: string): void => {
        say({ type: 'error', message });
        socket.close(code, message.slice(0, 120));
      };

      const authTimer = setTimeout(() => {
        if (!isAuthenticated) {
          socket.close(WS_CLOSE_UNAUTHENTICATED, 'No credentials were presented');
        }
      }, WS_AUTH_TIMEOUT_MS);

      socket.on('close', () => {
        clearTimeout(authTimer);

        for (const each of cleanup) {
          each();
        }
      });
      socket.on('error', (error: unknown) => {
        context.logger.debug({ err: error, traceId: request.traceId }, 'Camera socket failed');
      });

      socket.once('message', (raw: unknown) => {
        void (async (): Promise<void> => {
          const auth = cameraSocketAuthSchema.safeParse(
            ((): unknown => {
              try {
                return JSON.parse(String(raw));
              } catch {
                return undefined;
              }
            })(),
          );

          if (!auth.success || !params.success) {
            socket.close(WS_CLOSE_UNAUTHENTICATED, 'Authenticate first, for a camera that exists');

            return;
          }

          const entityId: EntityId = params.data.entityId;

          try {
            const claims = await verifyAccessToken(auth.data.token, context.jwtSecret);
            const identity = await context.authenticator.authenticate(auth.data.token);

            if (!(await readableEntityIds(context.db, identity)).has(entityId)) {
              refuse(WS_CLOSE_UNAVAILABLE, 'No camera has that id');

              return;
            }

            isAuthenticated = true;
            clearTimeout(authTimer);

            const expiry = setTimeout(
              () => {
                socket.close(WS_CLOSE_TOKEN_EXPIRED, 'The access token expired');
              },
              Math.max(0, claims.exp * 1000 - context.now().getTime()),
            );

            cleanup.push(() => {
              clearTimeout(expiry);
            });
          } catch {
            socket.close(WS_CLOSE_UNAUTHENTICATED, 'Those credentials are not valid');

            return;
          }

          const { bus } = context;

          if (bus === undefined) {
            refuse(WS_CLOSE_UNAVAILABLE, 'The hub cannot be reached');

            return;
          }

          let isBehind = false;
          // Listening before asking, so the key frame the hub sends a viewer who joins is heard.
          const frames = bus.subscribeRaw(busSubjects.cameraFrame(entityId), (data) => {
            if (socket.readyState !== socket.OPEN) {
              return;
            }

            const frame = decodeCameraFrame(data);

            if (frame === undefined) {
              return;
            }

            if (socket.bufferedAmount > MAXIMUM_BUFFERED_BYTES) {
              isBehind = true;

              return;
            }

            if (isBehind && !frame.isKey) {
              return;
            }

            isBehind = false;
            socket.send(data, { binary: true });
          });

          cleanup.push(() => {
            frames.unsubscribe();
          });

          /**
           * Opens the stream on the hub, or joins it, and says what it carries.
           *
           * @returns A promise that settles once the viewer has been told.
           */
          const open = async (): Promise<void> => {
            const opened = await bus.request(
              busSubjects.service(HUB_SERVICE, HUB_CAMERA_OPEN_METHOD),
              { entityId },
              cameraOpenReplySchema,
              { timeoutMs: OPEN_TIMEOUT_MS },
            );

            say({ type: 'init', track: opened.track });
          };

          try {
            await open();
          } catch (error: unknown) {
            refuse(
              WS_CLOSE_UNAVAILABLE,
              error instanceof Error ? error.message : 'The camera could not be opened',
            );

            return;
          }

          const keepalive = setInterval(() => {
            bus
              .request(
                busSubjects.service(HUB_SERVICE, HUB_CAMERA_KEEPALIVE_METHOD),
                { entityId },
                cameraKeepaliveReplySchema,
              )
              .then(async (reply) => {
                // The stream ended under a viewer still watching - the camera dropped it, the hub
                // restarted: open it again.
                if (!reply.isOpen) {
                  await open();
                }
              })
              .catch((error: unknown) => {
                context.logger.debug({ err: error, entityId }, 'Camera keepalive failed');
              });
          }, CAMERA_KEEPALIVE_EVERY_MS);

          cleanup.push(() => {
            clearInterval(keepalive);
          });
        })();
      });
    },
  );
}
