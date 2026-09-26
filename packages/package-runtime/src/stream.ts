/**
 * Stream sources: how a bundle reads a camera's picture.
 *
 * A camera's live picture is not state and does not go through a transport: it is frames, many a
 * second, for as long as somebody watches, over a connection of its own - RTSP, a vendor's own
 * socket - that has nothing to do with the device's other messages. So a vendor that ships a
 * camera ships a stream source beside its transports, and a profile's camera entity names it.
 *
 * The source only reads: it says what the stream carries, then hands over each frame as it came,
 * a JPEG or an H.264 access unit. The browser decodes (ARCHITECTURE.md 5.3), so nothing here
 * transcodes and nothing needs ffmpeg.
 */
import type { z } from 'zod';

import type { JsonObject } from '@nebula-home/contracts';

/** What a stream carries: stills, or H.264 with the codec string its decoder is set up with. */
export type StreamTrack =
  { readonly kind: 'jpeg' } | { readonly kind: 'h264'; readonly codec: string };

/** One frame of a stream. */
export type StreamFrame = {
  /** A JPEG, or an H.264 access unit in Annex B with its parameter sets before a key frame. */
  readonly data: Uint8Array;

  /** Whether a decoder can start from it. */
  readonly isKey: boolean;

  /** When it was taken, in microseconds from the start of the stream. */
  readonly timestampUs: number;
};

/** Where a source puts what it reads. */
export type StreamSink = {
  /** Says what the stream carries; called once, before the first frame. */
  describe: (track: StreamTrack) => void;

  /** Hands over one frame. */
  frame: (frame: StreamFrame) => void;
};

/** How a camera's picture is read. */
export type StreamSource = {
  /** `<vendor>/<name>`, as the profile names it. */
  readonly id: string;

  /** Validates the settings it reads the camera with: the instance's transport settings. */
  readonly configSchema: z.ZodType;

  /**
   * Reads the stream until the signal ends it or the camera does.
   *
   * @param config - The instance's transport settings, secrets opened.
   * @param args - What the profile's camera entity says to read.
   * @param sink - Where the track and the frames go.
   * @param signal - Ends the stream.
   * @returns A promise that settles when the stream ended; rejects with why, when it failed.
   */
  open: (config: unknown, args: JsonObject, sink: StreamSink, signal: AbortSignal) => Promise<void>;
};

/** A stream source as its author writes it, with its own configuration type. */
export type StreamSourceSpec<TConfig> = {
  readonly id: string;
  readonly configSchema: z.ZodType<TConfig>;
  open: (config: TConfig, args: JsonObject, sink: StreamSink, signal: AbortSignal) => Promise<void>;
};

/**
 * Turns a stream source written against its own configuration into one a registry can hold,
 * validating the settings on the way in as {@link defineTransport} does.
 *
 * @param spec - The source.
 * @returns The same source, its configuration parameter erased.
 */
export function defineStreamSource<TConfig>(spec: StreamSourceSpec<TConfig>): StreamSource {
  return {
    id: spec.id,
    configSchema: spec.configSchema,

    /**
     * Validates the settings, then reads.
     *
     * @param config - The settings.
     * @param args - What to read.
     * @param sink - Where it goes.
     * @param signal - Ends it.
     * @returns A promise that settles when it ended.
     */
    open: async (config, args, sink, signal) =>
      spec.open(spec.configSchema.parse(config), args, sink, signal),
  };
}

/** One access unit an RTSP session delivered. */
export type RtspFrame = StreamFrame & {
  /** The codec string of the stream, from its sequence parameters. */
  readonly codec: string;
};

/** What opening an RTSP session takes. */
export type RtspOptions = {
  /** `rtsp://user:password@host:port/path`, or `rtsps://` over TLS. */
  readonly url: string;

  /** Whether a TLS camera's certificate must chain to an authority this machine trusts. */
  readonly rejectUnauthorized?: boolean;

  /** Ends the session. */
  readonly signal: AbortSignal;
};

/**
 * Plays an RTSP stream over TCP and yields its H.264 access units.
 *
 * @throws {Error} From the iteration, when the camera refused or the session failed.
 */
export type OpenRtsp = (options: RtspOptions) => AsyncIterable<RtspFrame>;
