/**
 * Plays one camera into a canvas: the socket that brings its frames, and the decoding.
 *
 * The browser decodes (the contracts' camera.ts): the server only relays what the camera sent.
 * A stream of stills is drawn one image at a time; H.264 is decoded by the browser's own video
 * decoder (WebCodecs), fed each access unit as it arrives - in Annex B, which the decoder takes
 * without further description - and each decoded picture drawn and let go of at once. Nothing is
 * buffered for smoothness: a camera is watched to see what is happening now.
 *
 * A decoder that falls behind - a slow machine, a burst - skips to the next key frame rather than
 * queueing seconds of video. A browser without the decoder says so rather than showing a black
 * frame.
 *
 * Plain TypeScript, not a hook, so it can be driven from a test with a fake socket and a fake
 * decoder.
 */
import {
  decodeCameraFrame,
  type CameraSocketMessage,
  type CameraTrack,
} from '@nebula-home/contracts';

/** Where a player stands. */
export type CameraPlayerStatus = 'connecting' | 'playing' | 'unsupported' | 'error' | 'ended';

/** The part of a canvas the player draws on. */
export type CameraCanvas = {
  width: number;
  height: number;
  getContext: (kind: '2d') => Pick<CanvasRenderingContext2D, 'drawImage'> | null;
};

/** The part of a WebSocket the player uses. */
export type CameraSocket = Pick<
  WebSocket,
  'binaryType' | 'readyState' | 'send' | 'close' | 'onopen' | 'onmessage' | 'onclose' | 'onerror'
>;

/** What a player needs. */
export type CameraPlayerOptions = {
  /** The camera's socket URL. */
  readonly url: string;

  /** Reads the access token the session holds now. */
  readonly readAccessToken: () => string | null;

  /** Where the picture is drawn. */
  readonly canvas: CameraCanvas;

  /** Told where the player stands, with a reason a person can read when there is one. */
  readonly onStatus: (status: CameraPlayerStatus, message?: string) => void;

  /** Opens the socket; the browser's WebSocket when not said. */
  readonly openSocket?: (url: string) => CameraSocket;
};

/** How many pictures may wait in the decoder before the player skips to the next key frame. */
const DECODE_BACKLOG = 8;

/**
 * Plays one camera.
 */
export class CameraPlayer {
  readonly #options: CameraPlayerOptions;
  #socket: CameraSocket | undefined;
  #decoder: VideoDecoder | undefined;
  #track: CameraTrack | undefined;
  #isWaitingForKey = true;
  #isStopped = false;

  /**
   * Prepares the player without connecting.
   *
   * @param options - Where to connect, and where to draw.
   */
  public constructor(options: CameraPlayerOptions) {
    this.#options = options;
  }

  /** Connects, and plays what comes. */
  public start(): void {
    const { url, onStatus, readAccessToken } = this.#options;
    const open = this.#options.openSocket ?? ((address: string) => new WebSocket(address));
    const socket = open(url);

    this.#socket = socket;
    socket.binaryType = 'arraybuffer';
    onStatus('connecting');

    /** Authenticates, with the first message the socket sends. */
    socket.onopen = () => {
      const token = readAccessToken();

      if (token === null) {
        onStatus('error', 'You are signed out');
        socket.close();

        return;
      }

      socket.send(JSON.stringify({ type: 'auth', token }));
    };

    /**
     * Takes what the server says, as text, or a frame, as bytes.
     *
     * @param event - The message.
     */
    socket.onmessage = (event: MessageEvent) => {
      if (typeof event.data === 'string') {
        this.#onMessage(event.data);
      } else if (event.data instanceof ArrayBuffer) {
        this.#onFrame(new Uint8Array(event.data));
      }
    };

    /**
     * Says why the socket closed, when the player did not close it.
     *
     * @param event - The close.
     */
    socket.onclose = (event: CloseEvent) => {
      if (!this.#isStopped) {
        onStatus('ended', event.reason === '' ? 'The stream ended' : event.reason);
      }
    };

    /** Says the connection failed; the close that follows says why, when it can. */
    socket.onerror = () => {
      if (!this.#isStopped) {
        onStatus('error', 'The camera could not be reached');
      }
    };
  }

  /** Stops, and lets go of the socket and the decoder. */
  public stop(): void {
    this.#isStopped = true;
    this.#socket?.close();
    this.#socket = undefined;

    if (this.#decoder !== undefined && this.#decoder.state !== 'closed') {
      this.#decoder.close();
    }

    this.#decoder = undefined;
  }

  /**
   * Takes a message the server sent as text.
   *
   * @param text - The message.
   */
  #onMessage(text: string): void {
    let message: CameraSocketMessage;

    try {
      message = JSON.parse(text) as CameraSocketMessage;
    } catch {
      return;
    }

    if (message.type === 'error') {
      this.#options.onStatus('error', message.message);

      return;
    }

    this.#track = message.track;

    if (message.track.kind === 'h264') {
      void this.#configure(message.track.codec);
    }
  }

  /**
   * Sets the decoder up for the stream's codec.
   *
   * @param codec - The codec string.
   * @returns A promise that settles once it is set up, or found impossible.
   */
  async #configure(codec: string): Promise<void> {
    const { onStatus, canvas } = this.#options;

    if (typeof VideoDecoder === 'undefined') {
      onStatus('unsupported', 'This browser cannot decode the camera’s video');

      return;
    }

    const config: VideoDecoderConfig = { codec, optimizeForLatency: true };
    const support = await VideoDecoder.isConfigSupported(config).catch(() => undefined);

    if (support?.supported !== true) {
      onStatus('unsupported', `This browser cannot decode ${codec}`);

      return;
    }

    this.#decoder = new VideoDecoder({
      /**
       * Draws one decoded picture, and lets it go.
       *
       * @param picture - The picture.
       */
      output: (picture) => {
        if (canvas.width !== picture.displayWidth || canvas.height !== picture.displayHeight) {
          canvas.width = picture.displayWidth;
          canvas.height = picture.displayHeight;
        }

        canvas.getContext('2d')?.drawImage(picture, 0, 0);
        picture.close();
        onStatus('playing');
      },
      /**
       * Says the decoder failed.
       *
       * @param error - Why.
       */
      error: (error) => {
        onStatus('error', error.message);
      },
    });
    this.#decoder.configure(config);
    this.#isWaitingForKey = true;
  }

  /**
   * Takes a frame.
   *
   * @param bytes - The frame, header and all.
   */
  #onFrame(bytes: Uint8Array): void {
    const frame = decodeCameraFrame(bytes);

    if (frame === undefined || this.#track === undefined) {
      return;
    }

    if (this.#track.kind === 'jpeg') {
      void this.#drawStill(frame.data);

      return;
    }

    const decoder = this.#decoder;

    if (decoder?.state !== 'configured') {
      return;
    }

    if (decoder.decodeQueueSize > DECODE_BACKLOG) {
      this.#isWaitingForKey = true;
    }

    if (this.#isWaitingForKey && !frame.isKey) {
      return;
    }

    this.#isWaitingForKey = false;
    decoder.decode(
      new EncodedVideoChunk({
        type: frame.isKey ? 'key' : 'delta',
        timestamp: frame.timestampUs,
        data: frame.data,
      }),
    );
  }

  /**
   * Draws one still.
   *
   * @param data - The JPEG.
   * @returns A promise that settles once it is drawn, or could not be.
   */
  async #drawStill(data: Uint8Array): Promise<void> {
    const { canvas, onStatus } = this.#options;

    try {
      const image = await createImageBitmap(new Blob([data as BlobPart], { type: 'image/jpeg' }));

      if (canvas.width !== image.width || canvas.height !== image.height) {
        canvas.width = image.width;
        canvas.height = image.height;
      }

      canvas.getContext('2d')?.drawImage(image, 0, 0);
      image.close();
      onStatus('playing');
    } catch {
      // One unreadable still: the next one comes in a moment.
    }
  }
}

/**
 * Where a camera's socket is, next to wherever the page was served from.
 *
 * @param entityId - The camera.
 * @returns The socket URL.
 */
export function cameraSocketUrl(entityId: string): string {
  const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws';

  return `${scheme}://${window.location.host}/api/v1/cameras/${encodeURIComponent(entityId)}/live`;
}
