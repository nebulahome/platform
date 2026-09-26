/**
 * A camera's live picture, from the device to the browser that draws it.
 *
 * The browser decodes: the hub reads what the camera sends - JPEG stills, or H.264 as RTSP
 * carries it - and hands each frame on as it came, through `api`, to the page, which draws a JPEG
 * as an image and decodes H.264 with the browser's own video decoder. Nothing on the way
 * transcodes, so no service carries ffmpeg and the camera's own quality reaches the screen.
 *
 * A stream runs while somebody watches: `api` opens it on the hub for a viewer and keeps it open
 * while the viewer's socket is; the hub runs one stream per camera however many watch it, and
 * closes it a little after the last one left. The frames travel as bytes on the bus - the one
 * message that is not an envelope - each behind a small header of its own.
 */
import { z } from 'zod';

import { entityIdSchema } from './entity-id.js';
import { timestampSchema } from './timestamp.js';

/** Opens a camera's stream on the hub, or joins the one running, and says what it carries. */
export const HUB_CAMERA_OPEN_METHOD = 'camera_open';

/** Says a viewer is still watching, so the hub keeps the stream running. */
export const HUB_CAMERA_KEEPALIVE_METHOD = 'camera_keepalive';

/** Takes a still from a camera that sends stills. */
export const HUB_CAMERA_SNAPSHOT_METHOD = 'camera_snapshot';

/** How long a stream is kept without a keepalive, in milliseconds. */
export const CAMERA_KEEPALIVE_WINDOW_MS = 20_000;

/** How often a viewer's side says it is still watching. */
export const CAMERA_KEEPALIVE_EVERY_MS = 8000;

/**
 * What a stream carries, and so how the browser draws it.
 *
 * `codec` is the codec string the browser's decoder is configured with - `avc1.640028` - read
 * from the stream's own parameters.
 */
export const cameraTrackSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('jpeg') }),
  z.object({ kind: z.literal('h264'), codec: z.string().regex(/^avc1\.[0-9a-f]{6}$/iu) }),
]);

/** What a stream carries. */
export type CameraTrack = z.output<typeof cameraTrackSchema>;

/** Asks the hub for a camera's stream. */
export const cameraOpenRequestSchema = z.strictObject({ entityId: entityIdSchema });

/** Asks the hub for a camera's stream. */
export type CameraOpenRequest = z.output<typeof cameraOpenRequestSchema>;

/** What the stream carries, once the camera has said. */
export const cameraOpenReplySchema = z.object({ track: cameraTrackSchema });

/** What the stream carries. */
export type CameraOpenReply = z.output<typeof cameraOpenReplySchema>;

/** Says a viewer of a camera is still watching. */
export const cameraKeepaliveRequestSchema = z.strictObject({ entityId: entityIdSchema });

/** Says a viewer of a camera is still watching. */
export type CameraKeepaliveRequest = z.output<typeof cameraKeepaliveRequestSchema>;

/** Whether the stream is still running; false once it ended, and a viewer should open it again. */
export const cameraKeepaliveReplySchema = z.object({ isOpen: z.boolean() });

/** Whether the stream is still running. */
export type CameraKeepaliveReply = z.output<typeof cameraKeepaliveReplySchema>;

/** Asks the hub for a still. */
export const cameraSnapshotRequestSchema = z.strictObject({ entityId: entityIdSchema });

/** Asks the hub for a still. */
export type CameraSnapshotRequest = z.output<typeof cameraSnapshotRequestSchema>;

/** The still, as base64 JPEG - a request's reply is an envelope - and when it was taken. */
export const cameraSnapshotReplySchema = z.object({
  jpeg: z.base64().max(1_400_000),
  capturedAt: timestampSchema,
});

/** The still. */
export type CameraSnapshotReply = z.output<typeof cameraSnapshotReplySchema>;

/** One frame, as the bus and the browser's socket carry it. */
export type CameraFrame = {
  /** Whether it starts a picture on its own: a JPEG always, an H.264 frame when it is an IDR. */
  readonly isKey: boolean;

  /** When the camera took it, in microseconds from the start of the stream. */
  readonly timestampUs: number;

  /** The JPEG, or the H.264 access unit in Annex B. */
  readonly data: Uint8Array;
};

/** The header's length: a version, the flags, and the timestamp as a 64-bit float. */
const FRAME_HEADER_BYTES = 10;

/** The version of the header, so a change to it is refused rather than misread. */
const FRAME_VERSION = 1;

/** The largest frame carried; a larger one is dropped, since the bus refuses a megabyte. */
export const CAMERA_FRAME_MAXIMUM_BYTES = 900_000;

/**
 * Writes a frame as bytes: its header, then its data.
 *
 * @param frame - The frame.
 * @returns The bytes.
 */
export function encodeCameraFrame(frame: CameraFrame): Uint8Array {
  const bytes = new Uint8Array(FRAME_HEADER_BYTES + frame.data.byteLength);
  const view = new DataView(bytes.buffer);

  view.setUint8(0, FRAME_VERSION);
  view.setUint8(1, frame.isKey ? 1 : 0);
  view.setFloat64(2, frame.timestampUs);
  bytes.set(frame.data, FRAME_HEADER_BYTES);

  return bytes;
}

/**
 * Reads a frame back from its bytes.
 *
 * @param bytes - What arrived.
 * @returns The frame, or undefined for bytes that are not one.
 */
export function decodeCameraFrame(bytes: Uint8Array): CameraFrame | undefined {
  if (bytes.byteLength <= FRAME_HEADER_BYTES) {
    return undefined;
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  if (view.getUint8(0) !== FRAME_VERSION) {
    return undefined;
  }

  return {
    isKey: (view.getUint8(1) & 1) === 1,
    timestampUs: view.getFloat64(2),
    data: bytes.subarray(FRAME_HEADER_BYTES),
  };
}

/**
 * What a camera socket's first message must be: the access token, as the live channel takes it,
 * because a token in a URL ends up in logs.
 */
export const cameraSocketAuthSchema = z.strictObject({
  type: z.literal('auth'),
  token: z.string().min(1).max(4096),
});

/** A camera socket's first message. */
export type CameraSocketAuth = z.output<typeof cameraSocketAuthSchema>;

/**
 * What the server says on a camera socket, as text; the frames themselves come as bytes.
 *
 * `init` comes once, before the first frame, with what the stream carries. `error` ends the
 * socket with a reason a person can read.
 */
export const cameraSocketMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('init'), track: cameraTrackSchema }),
  z.object({ type: z.literal('error'), message: z.string().max(512) }),
]);

/** What the server says on a camera socket. */
export type CameraSocketMessage = z.output<typeof cameraSocketMessageSchema>;
