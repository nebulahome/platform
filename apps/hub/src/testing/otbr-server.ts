/**
 * An OpenThread Border Router's REST API on loopback, for the Thread broker's tests: the calls
 * the broker makes, answered the way the pinned ot-br-posix answers them - camelCase JSON, the
 * active dataset only taken while Thread is off, a pending one only while attached, 204 for a
 * dataset there is none of.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

/** What the fake border router holds, which a test reads and changes. */
export type FakeOtbrState = {
  /** `disabled`, `detached`, `child`, `router`, `leader`. */
  role: string;

  /** The active dataset as JSON, or null for none. */
  active: Record<string, unknown> | null;

  /** The active dataset as TLV hex, or null for none. */
  activeTlvs: string | null;

  /** Every pending dataset sent, as sent. */
  readonly pending: unknown[];

  /** The device collection's items. */
  devices: unknown[];

  /** Every action posted, by type. */
  readonly actions: string[];
  coprocessorVersion: string;
  extAddress: string;
};

/** A fake border router, listening. */
export type FakeOtbr = {
  readonly url: string;
  readonly state: FakeOtbrState;
  readonly close: () => Promise<void>;
};

/** The dataset a network formed on the fake has, before what was sent is laid over it. */
const FORMED = {
  activeTimestamp: { seconds: 1, ticks: 0, authoritative: false },
  networkKey: '00112233445566778899aabbccddeeff',
  networkName: 'OpenThread',
  extPanId: 'dead00beef00cafe',
  meshLocalPrefix: 'fd11:22:0:0::/64',
  panId: 0x1a2b,
  channel: 15,
};

/** The TLVs the fake hands out for any dataset. */
export const FAKE_TLVS = '0e080000000000010000000300000f35060004001fffe0';

/**
 * Reads a request's body.
 *
 * @param request - The request.
 * @returns Its text.
 */
async function bodyOf(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(chunk as Buffer);
  }

  return Buffer.concat(chunks).toString('utf8');
}

/**
 * Answers with JSON.
 *
 * @param response - The response.
 * @param value - What to send; nothing for 204.
 * @param status - The status.
 */
function send(response: ServerResponse, value: unknown, status = 200): void {
  if (value === undefined) {
    response.writeHead(status).end();

    return;
  }

  response.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(value));
}

/**
 * Starts a fake border router.
 *
 * @param state - What it holds at first, over its defaults.
 * @returns It, listening on a free port.
 */
export async function startFakeOtbr(state: Partial<FakeOtbrState> = {}): Promise<FakeOtbr> {
  const held: FakeOtbrState = {
    role: 'disabled',
    active: null,
    activeTlvs: null,
    pending: [],
    devices: [],
    actions: [],
    coprocessorVersion: 'SL-OPENTHREAD/2.4.4.0; EFR32',
    extAddress: '0a0b0c0d0e0f1011',
    ...state,
  };

  /**
   * Answers one request.
   *
   * @param request - The request.
   * @param response - The response.
   * @returns Once answered.
   */
  const handle = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const route = `${request.method ?? ''} ${request.url ?? ''}`;
    const body = await bodyOf(request);
    const isText =
      request.headers.accept === 'text/plain' || request.headers['content-type'] === 'text/plain';

    switch (route) {
      case 'GET /node/state': {
        send(response, held.role);

        return;
      }

      case 'PUT /node/state': {
        const asked = JSON.parse(body) as string;

        // Turned on with a network, it leads it; on already, it keeps its role.
        if (asked !== 'enable') {
          held.role = 'disabled';
        } else if (held.role === 'disabled') {
          held.role = held.active === null ? 'detached' : 'leader';
        }

        send(response, undefined);

        return;
      }

      case 'GET /node/ext-address': {
        send(response, held.extAddress);

        return;
      }

      case 'GET /node/coprocessor/version': {
        send(response, held.coprocessorVersion);

        return;
      }

      case 'GET /node/dataset/active': {
        if (held.active === null) {
          send(response, undefined, 204);
        } else if (isText) {
          response.writeHead(200, { 'Content-Type': 'text/plain' }).end(held.activeTlvs ?? '');
        } else {
          send(response, held.active);
        }

        return;
      }

      case 'PUT /node/dataset/active': {
        if (held.role !== 'disabled') {
          send(response, { title: 'Conflict', status: 409 }, 409);

          return;
        }

        held.active = isText
          ? { ...FORMED, networkName: 'Joined' }
          : { ...FORMED, ...(JSON.parse(body) as Record<string, unknown>) };
        held.activeTlvs = isText ? body.toLowerCase() : FAKE_TLVS;
        send(response, undefined);

        return;
      }

      case 'GET /node/dataset/pending': {
        send(response, undefined, 204);

        return;
      }

      case 'PUT /node/dataset/pending': {
        if (!['child', 'router', 'leader'].includes(held.role)) {
          send(response, { title: 'Conflict', status: 409 }, 409);

          return;
        }

        held.pending.push(JSON.parse(body));
        send(response, undefined);

        return;
      }

      case 'GET /api/devices': {
        send(response, { data: held.devices });

        return;
      }

      case 'POST /api/actions': {
        const posted = JSON.parse(body) as { data: { type: string }[] };

        held.actions.push(...posted.data.map((each) => each.type));
        send(response, { data: [{ id: `a${String(held.actions.length)}`, type: 'action' }] });

        return;
      }

      default: {
        send(response, { title: 'Not Found', status: 404 }, 404);
      }
    }
  };

  const server = createServer((request, response) => {
    void handle(request, response);
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });

  return {
    url: `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`,
    state: held,

    /**
     * Stops listening, dropping open connections.
     *
     * @returns Once closed.
     */
    close: async () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => {
          resolve();
        });
      }),
  };
}
