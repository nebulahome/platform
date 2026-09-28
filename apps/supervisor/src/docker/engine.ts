/**
 * Docker's API, spoken over its socket.
 *
 * Plain HTTP on a Unix socket - `node:http` with a `socketPath` - rather than a client library:
 * the calls the supervisor makes are a dozen, each answer is validated with a schema of its own
 * (`engine-schemas.ts`) as every boundary is, and the libraries that exist bring an SSH client
 * and a transport layer for hosts the supervisor never reaches.
 *
 * The API version is agreed once, from what the engine says it speaks, capped at the newest this
 * file was written against, so a newer engine answers in the shape these schemas know.
 */
import http from 'node:http';

import type { z } from 'zod';

import {
  ConflictError,
  DeviceUnavailableError,
  NotFoundError,
  UpstreamError,
  type JsonObject,
} from '@nebula-home/contracts';

import {
  containerListSchema,
  containerStatsSchema,
  createdContainerSchema,
  engineErrorSchema,
  engineEventSchema,
  engineInfoSchema,
  engineVersionSchema,
  inspectedContainerSchema,
  inspectedImageSchema,
  inspectedNetworkSchema,
  pullProgressSchema,
  type ContainerStats,
  type EngineEvent,
  type EngineInfo,
  type EngineVersion,
  type InspectedContainer,
  type InspectedImage,
  type InspectedNetwork,
  type ListedContainer,
  type PullProgress,
} from './engine-schemas.js';

/** The newest API version these schemas were written against. */
export const NEWEST_API_VERSION = '1.47';

/** The version from which a volume can be mounted in part, `VolumeOptions.Subpath`. */
export const SUBPATH_API_VERSION = '1.45';

/** The most a buffered answer may hold: a list of a few hundred containers, a log's tail. */
const MAXIMUM_BODY_BYTES = 32 * 1024 * 1024;

/** How long a container is given to stop before it is killed, in seconds. */
const STOP_GRACE_SECONDS = 20;

/** What calling the engine takes. */
export type EngineOptions = {
  /** The socket: `/var/run/docker.sock`, or a named pipe on a Windows development machine. */
  readonly socketPath: string;

  /** How long one call may take, a pull and a stream aside. */
  readonly timeoutMs: number;
};

/** One call's details. */
type CallOptions = {
  readonly query?: Readonly<Record<string, string | number | boolean | undefined>>;
  readonly body?: unknown;
  readonly signal?: AbortSignal | undefined;

  /** Null for a call that may run as long as it runs: a pull, the event stream. */
  readonly timeoutMs?: number | null;
};

/**
 * Compares two API versions.
 *
 * @param left - One version, as `1.45`.
 * @param right - The other.
 * @returns A negative number, zero or a positive number, as `left` is older, the same or newer.
 */
export function compareApiVersions(left: string, right: string): number {
  const [leftMajor = 0, leftMinor = 0] = left.split('.').map(Number);
  const [rightMajor = 0, rightMinor = 0] = right.split('.').map(Number);

  return leftMajor === rightMajor ? leftMinor - rightMinor : leftMajor - rightMajor;
}

/** A call the engine refused, with what it said. */
type Refusal = { readonly status: number; readonly message: string };

/**
 * Turns a refused call into the platform's error for it.
 *
 * @param refusal - The status and Docker's sentence.
 * @param what - What was being done, for the message.
 * @returns The error to throw.
 */
function errorFor(refusal: Refusal, what: string): Error {
  const details = { status: refusal.status, message: refusal.message };

  if (refusal.status === 404) {
    return new NotFoundError(`Docker could not find it: ${refusal.message}`, { details });
  }

  if (refusal.status === 409) {
    return new ConflictError(`Docker refused to ${what}: ${refusal.message}`, { details });
  }

  return new UpstreamError(`Docker could not ${what}: ${refusal.message}`, { details });
}

/** Docker's API, over its socket. */
export class DockerEngine {
  readonly #options: EngineOptions;
  #apiVersion: string | null = null;

  /**
   * Creates a client. Nothing is opened until the first call.
   *
   * @param options - The socket and the timeout.
   */
  public constructor(options: EngineOptions) {
    this.#options = options;
  }

  /**
   * The API version agreed, once {@link negotiate} has run.
   *
   * @returns The version, or null before it.
   */
  public get apiVersion(): string | null {
    return this.#apiVersion;
  }

  /**
   * Asks the engine what it speaks and agrees a version with it.
   *
   * @returns What the engine says about itself.
   * @throws {DeviceUnavailableError} When the socket cannot be reached.
   */
  public async negotiate(): Promise<EngineVersion> {
    const version = await this.#json(engineVersionSchema, 'GET', '/version', 'say its version', {
      isVersioned: false,
    });

    this.#apiVersion =
      compareApiVersions(version.ApiVersion, NEWEST_API_VERSION) > 0
        ? NEWEST_API_VERSION
        : version.ApiVersion;

    return version;
  }

  /**
   * What the engine says about the machine: its processors and its memory.
   *
   * @returns The two fields read.
   */
  public async info(): Promise<EngineInfo> {
    return this.#json(engineInfoSchema, 'GET', '/info', 'describe the machine');
  }

  /**
   * Every container, running or not.
   *
   * @returns The list.
   */
  public async listContainers(): Promise<ListedContainer[]> {
    return this.#json(containerListSchema, 'GET', '/containers/json', 'list the containers', {
      query: { all: true },
    });
  }

  /**
   * Everything about one container.
   *
   * @param id - Its id or name.
   * @returns The answer, whole: what is not read is kept, for a recreate to hand back.
   */
  public async inspectContainer(id: string): Promise<InspectedContainer> {
    return this.#json(
      inspectedContainerSchema,
      'GET',
      `/containers/${encodeURIComponent(id)}/json`,
      'inspect the container',
    );
  }

  /**
   * One reading of a running container's counters, without waiting for a second.
   *
   * @param id - Its id.
   * @returns The counters.
   */
  public async stats(id: string): Promise<ContainerStats> {
    return this.#json(
      containerStatsSchema,
      'GET',
      `/containers/${encodeURIComponent(id)}/stats`,
      'measure the container',
      { query: { stream: false, 'one-shot': true } },
    );
  }

  /**
   * Starts, stops or restarts a container. One already in that state is not an error.
   *
   * @param id - Its id or name.
   * @param action - What to do.
   */
  public async control(id: string, action: 'start' | 'stop' | 'restart'): Promise<void> {
    await this.#empty('POST', `/containers/${encodeURIComponent(id)}/${action}`, `${action} it`, {
      query: action === 'start' ? {} : { t: STOP_GRACE_SECONDS },
      timeoutMs: this.#options.timeoutMs + STOP_GRACE_SECONDS * 1000,
    });
  }

  /**
   * The last lines a container wrote, as Docker sends them: multiplexed when it has no terminal.
   *
   * @param id - Its id.
   * @param tail - How many lines.
   * @param since - Only the lines Docker received from then on, as seconds since 1970 and their
   *   fraction; the line at that moment itself is sent again.
   * @returns The raw bytes.
   */
  public async logs(id: string, tail: number, since?: string): Promise<Buffer> {
    const response = await this.#call('GET', `/containers/${encodeURIComponent(id)}/logs`, {
      query: {
        stdout: true,
        stderr: true,
        timestamps: true,
        tail,
        ...(since === undefined ? {} : { since }),
      },
    });

    return this.#bodyOf(response, 'read its logs');
  }

  /**
   * Everything about one image.
   *
   * @param reference - Its id or `name:tag`.
   * @returns The answer, or undefined when the image is not on the machine.
   */
  public async inspectImage(reference: string): Promise<InspectedImage | undefined> {
    try {
      return await this.#json(
        inspectedImageSchema,
        'GET',
        `/images/${encodeURIComponent(reference)}/json`,
        'inspect the image',
      );
    } catch (error: unknown) {
      if (error instanceof NotFoundError) {
        return undefined;
      }

      throw error;
    }
  }

  /**
   * Pulls an image, reporting progress as it goes.
   *
   * @param image - The image without a tag.
   * @param tag - The tag.
   * @param onProgress - Handed each line of progress.
   * @param signal - Ends the pull.
   * @throws {UpstreamError} When the pull ends with an error line: Docker answers 200 and says it
   * failed in the stream.
   */
  public async pull(
    image: string,
    tag: string,
    onProgress: (progress: PullProgress) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    const response = await this.#call('POST', '/images/create', {
      query: { fromImage: image, tag },
      signal,
      timeoutMs: null,
    });

    if ((response.statusCode ?? 500) >= 400) {
      throw errorFor(await this.#refusalOf(response), `pull ${image}:${tag}`);
    }

    for await (const line of lines(response)) {
      const progress = pullProgressSchema.parse(JSON.parse(line));

      if (progress.error !== undefined) {
        throw new UpstreamError(`Docker could not pull ${image}:${tag}: ${progress.error}`, {
          details: { image, tag },
        });
      }

      onProgress(progress);
    }
  }

  /**
   * Creates a container.
   *
   * @param name - Its name.
   * @param body - Its configuration, in Docker's shape.
   * @returns Its id.
   */
  public async createContainer(name: string, body: JsonObject): Promise<string> {
    const created = await this.#json(
      createdContainerSchema,
      'POST',
      '/containers/create',
      `create ${name}`,
      { query: { name }, body },
    );

    return created.Id;
  }

  /**
   * Renames a container.
   *
   * @param id - Its id.
   * @param name - Its new name.
   */
  public async renameContainer(id: string, name: string): Promise<void> {
    await this.#empty('POST', `/containers/${encodeURIComponent(id)}/rename`, 'rename it', {
      query: { name },
    });
  }

  /**
   * Removes a container, running or not. Its named volumes stay whatever is asked.
   *
   * @param id - Its id.
   * @param removeVolumes - Whether the volumes Docker made for it alone go with it.
   */
  public async removeContainer(id: string, removeVolumes = false): Promise<void> {
    await this.#empty('DELETE', `/containers/${encodeURIComponent(id)}`, 'remove it', {
      query: { force: true, v: removeVolumes },
    });
  }

  /**
   * Reads a network.
   *
   * @param name - Its name or id.
   * @returns It, or undefined when there is none by that name.
   */
  public async inspectNetwork(name: string): Promise<InspectedNetwork | undefined> {
    try {
      return await this.#json(
        inspectedNetworkSchema,
        'GET',
        `/networks/${encodeURIComponent(name)}`,
        'inspect the network',
      );
    } catch (error: unknown) {
      if (error instanceof NotFoundError) {
        return undefined;
      }

      throw error;
    }
  }

  /**
   * Creates a bridge network.
   *
   * @param name - Its name.
   * @param labels - Its labels.
   */
  public async createNetwork(name: string, labels: Record<string, string>): Promise<void> {
    await this.#empty('POST', '/networks/create', `create the network ${name}`, {
      body: { Name: name, Driver: 'bridge', CheckDuplicate: true, Labels: labels },
    });
  }

  /**
   * Attaches a container to a network, under names others there can reach it by.
   *
   * @param network - The network's name.
   * @param container - The container's id.
   * @param aliases - The names.
   */
  public async connectNetwork(
    network: string,
    container: string,
    aliases: readonly string[],
  ): Promise<void> {
    await this.#empty(
      'POST',
      `/networks/${encodeURIComponent(network)}/connect`,
      `attach it to ${network}`,
      { body: { Container: container, EndpointConfig: { Aliases: aliases } } },
    );
  }

  /**
   * Takes a container off a network.
   *
   * @param network - The network's name.
   * @param container - The container's id.
   */
  public async disconnectNetwork(network: string, container: string): Promise<void> {
    await this.#empty(
      'POST',
      `/networks/${encodeURIComponent(network)}/disconnect`,
      `take it off ${network}`,
      { body: { Container: container, Force: true } },
    );
  }

  /**
   * Follows what happens to containers until the signal ends it.
   *
   * @param signal - Ends the stream.
   * @yields {EngineEvent} Each event, as it happens.
   */
  public async *events(signal: AbortSignal): AsyncGenerator<EngineEvent> {
    const response = await this.#call('GET', '/events', {
      query: { filters: JSON.stringify({ type: ['container'] }) },
      signal,
      timeoutMs: null,
    });

    if ((response.statusCode ?? 500) >= 400) {
      throw errorFor(await this.#refusalOf(response), 'follow its events');
    }

    for await (const line of lines(response)) {
      const parsed = engineEventSchema.safeParse(JSON.parse(line));

      if (parsed.success) {
        yield parsed.data;
      }
    }
  }

  /**
   * Makes one call and parses its answer.
   *
   * @param schema - What the answer must satisfy.
   * @param method - The HTTP method.
   * @param path - The path, without the version.
   * @param what - What is being done, for an error's message.
   * @param options - The query, the body, and whether the path is versioned.
   * @returns The parsed answer.
   */
  async #json<TSchema extends z.ZodType>(
    schema: TSchema,
    method: string,
    path: string,
    what: string,
    options: CallOptions & { readonly isVersioned?: boolean } = {},
  ): Promise<z.output<TSchema>> {
    const response = await this.#call(method, path, options);
    const body = await this.#bodyOf(response, what);

    return schema.parse(JSON.parse(body.toString('utf8')));
  }

  /**
   * Makes one call whose answer is empty, or `304` for something already done.
   *
   * @param method - The HTTP method.
   * @param path - The path, without the version.
   * @param what - What is being done.
   * @param options - The query and the body.
   */
  async #empty(method: string, path: string, what: string, options: CallOptions): Promise<void> {
    const response = await this.#call(method, path, options);

    if (response.statusCode === 304) {
      response.resume();

      return;
    }

    await this.#bodyOf(response, what);
  }

  /**
   * Reads a whole answer, refusing it when its status is a failure.
   *
   * @param response - The answer.
   * @param what - What was being done.
   * @returns The bytes.
   */
  async #bodyOf(response: http.IncomingMessage, what: string): Promise<Buffer> {
    if ((response.statusCode ?? 500) >= 400) {
      throw errorFor(await this.#refusalOf(response), what);
    }

    return readAll(response);
  }

  /**
   * Reads what Docker said when it refused.
   *
   * @param response - The refusal.
   * @returns Its status and sentence.
   */
  async #refusalOf(response: http.IncomingMessage): Promise<Refusal> {
    const status = response.statusCode ?? 500;
    const text = (await readAll(response)).toString('utf8');

    try {
      return { status, message: engineErrorSchema.parse(JSON.parse(text)).message };
    } catch {
      // Not JSON: a proxy in front of the socket, or an old engine. The text is what there is.
      return { status, message: text.trim().slice(0, 500) || `status ${String(status)}` };
    }
  }

  /**
   * Sends one request over the socket.
   *
   * @param method - The HTTP method.
   * @param path - The path, without the version.
   * @param options - The query, the body, the signal, the timeout, and whether it is versioned.
   * @returns The answer, before its body is read.
   * @throws {DeviceUnavailableError} When the socket cannot be reached.
   */
  async #call(
    method: string,
    path: string,
    options: CallOptions & { readonly isVersioned?: boolean } = {},
  ): Promise<http.IncomingMessage> {
    const search = new URLSearchParams();

    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined) {
        search.set(key, String(value));
      }
    }

    const prefix =
      options.isVersioned === false || this.#apiVersion === null ? '' : `/v${this.#apiVersion}`;
    const query = search.size === 0 ? '' : `?${search.toString()}`;
    const payload = options.body === undefined ? undefined : JSON.stringify(options.body);
    const timeoutMs = options.timeoutMs === undefined ? this.#options.timeoutMs : options.timeoutMs;
    const signals = [
      ...(options.signal === undefined ? [] : [options.signal]),
      ...(timeoutMs === null ? [] : [AbortSignal.timeout(timeoutMs)]),
    ];

    return new Promise((resolve, reject) => {
      const request = http.request(
        {
          socketPath: this.#options.socketPath,
          path: `${prefix}${path}${query}`,
          method,
          headers:
            payload === undefined
              ? {}
              : {
                  'content-type': 'application/json',
                  'content-length': Buffer.byteLength(payload),
                },
          signal: signals.length === 0 ? undefined : AbortSignal.any(signals),
        },
        resolve,
      );

      request.on('error', (error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT' || error.code === 'ECONNREFUSED' || error.code === 'EACCES') {
          reject(
            new DeviceUnavailableError(`Docker cannot be reached at ${this.#options.socketPath}`, {
              details: { socket: this.#options.socketPath, code: error.code },
              cause: error,
            }),
          );

          return;
        }

        reject(error);
      });

      request.end(payload);
    });
  }
}

/**
 * Reads a whole answer, bounded.
 *
 * @param response - The answer.
 * @returns Its bytes.
 * @throws {UpstreamError} When it is larger than any answer read whole should be.
 */
async function readAll(response: http.IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of response) {
    const buffer = chunk as Buffer;

    size += buffer.length;

    if (size > MAXIMUM_BODY_BYTES) {
      response.destroy();

      throw new UpstreamError('Docker answered with more than can be read at once', {
        details: { bytes: size },
      });
    }

    chunks.push(buffer);
  }

  return Buffer.concat(chunks);
}

/**
 * Splits a streamed answer into its lines of JSON.
 *
 * @param response - The answer.
 * @yields {string} Each non-empty line, as it arrives.
 */
async function* lines(response: http.IncomingMessage): AsyncGenerator<string> {
  let pending = '';

  for await (const chunk of response) {
    pending += (chunk as Buffer).toString('utf8');

    let newline = pending.indexOf('\n');

    while (newline !== -1) {
      const line = pending.slice(0, newline).trim();

      pending = pending.slice(newline + 1);

      if (line.length > 0) {
        yield line;
      }

      newline = pending.indexOf('\n');
    }
  }

  if (pending.trim().length > 0) {
    yield pending.trim();
  }
}
