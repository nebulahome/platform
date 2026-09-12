/**
 * The discovery routes against a hub that answers on a bus in memory.
 *
 * Three relays, so what is asserted is what reaches the hub and what comes back: the pass
 * request as typed, the candidates as held, an adoption as written - and the two ways it does
 * not happen, without the permission and without the bus.
 */
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { BusClient } from '@nebula-home/bus';
import { FakeTransport } from '@nebula-home/bus/testing';
import {
  adoptRequestSchema,
  busSubjects,
  candidatesRequestSchema,
  discoverRequestSchema,
  entityIdSchema,
  HUB_ADOPT_METHOD,
  HUB_CANDIDATES_METHOD,
  HUB_DISCOVER_METHOD,
  HUB_SERVICE,
  NotFoundError,
  type AdoptReply,
  type AdoptRequest,
  type CandidatesReply,
  type DiscoverReply,
  type DiscoverRequest,
} from '@nebula-home/contracts';
import { secretsKeyFrom } from '@nebula-home/db';
import { createLogger } from '@nebula-home/logging';

import { Authenticator } from '../auth/authenticator.js';
import { ChallengeStore } from '../auth/challenges.js';
import { signAccessToken } from '../auth/tokens.js';
import { apiEnvSchema } from '../config.js';
import type { ApiContext } from '../context.js';
import { IdempotencyStore } from '../http/idempotency.js';
import { buildServer } from '../server.js';
import { AuditLog } from '../services/audit.js';
import { EventFanout } from '../services/events.js';

/** An environment good enough to build a server from. */
const ENVIRONMENT = {
  NODE_ENV: 'test',
  LOG_LEVEL: 'fatal',
  DATABASE_URL: 'postgres://nebula:nebula@localhost:5432/nebula',
  NATS_URL: 'nats://localhost:4222',
  API_JWT_SECRET: 'a-test-signing-key-of-at-least-32-chars',
  API_TOTP_ENCRYPTION_KEY: '00'.repeat(32),
  NEBULA_SECRETS_KEY: '11'.repeat(32),
};

/** The one entity the printer would produce. */
const LIGHT = entityIdSchema.parse('light.d_01p00a000000042_chamber_light');

/** What the fake hub has found. */
const CANDIDATES: CandidatesReply = {
  isScanning: true,
  candidates: [
    {
      candidateId: 'scan-1:01P00A000000042',
      integrationId: 'bambu-lab-1',
      externalId: '01P00A000000042',
      name: 'Bambu Lab P1S',
      manufacturer: 'Bambu Lab',
      model: 'P1S',
      entities: [
        {
          entityId: LIGHT,
          name: 'Chamber light',
          capabilities: ['on_off'],
        },
      ],
      evidence: {},
    },
  ],
};

let server: FastifyInstance;
let discovered: DiscoverRequest[] = [];
let adopted: AdoptRequest[] = [];
let stopHub: () => void;

/**
 * Builds the real server around a stub database and a hub on an in-memory bus.
 *
 * @param isBusUp - Whether the server gets a bus at all.
 * @returns The server, ready to inject into.
 */
async function buildTestServer(isBusUp: boolean): Promise<FastifyInstance> {
  const config = apiEnvSchema.parse(ENVIRONMENT);
  const logger = createLogger({ service: 'api', version: '0.0.0', level: 'fatal' });
  const secret = new TextEncoder().encode(config.API_JWT_SECRET);
  const transport = new FakeTransport();

  const hub = new BusClient({ transport, source: 'hub', logger, requestTimeoutMs: 500 });
  const subscriptions = [
    hub.serve(
      busSubjects.service(HUB_SERVICE, HUB_DISCOVER_METHOD),
      discoverRequestSchema,
      (request: DiscoverRequest): DiscoverReply => {
        discovered.push(request);

        return {
          scanId: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
          integrationIds: [request.integrationId ?? 'bambu-lab-1'],
        };
      },
    ),
    hub.serve(
      busSubjects.service(HUB_SERVICE, HUB_CANDIDATES_METHOD),
      candidatesRequestSchema,
      (): CandidatesReply => CANDIDATES,
    ),
    hub.serve(
      busSubjects.service(HUB_SERVICE, HUB_ADOPT_METHOD),
      adoptRequestSchema,
      (request: AdoptRequest): AdoptReply => {
        adopted.push(request);

        if (request.candidateId !== CANDIDATES.candidates[0]?.candidateId) {
          throw new NotFoundError(`No candidate ${request.candidateId} in the current scan`);
        }

        return {
          deviceId: '00000000-0000-4000-8000-000000000010',
          entityIds: [LIGHT],
        };
      },
    ),
  ];

  stopHub = (): void => {
    for (const subscription of subscriptions) {
      subscription.unsubscribe();
    }
  };

  const db = {
    /**
     * Stands in for a database that is not there.
     *
     * @returns Never; it always rejects.
     */
    execute: (): Promise<never> => Promise.reject(new Error('no database in this test')),

    /**
     * Stands in for the audit table, which the routes write to and nothing here reads.
     *
     * @returns A chain whose values resolve to nothing.
     */
    insert: (): { values: () => Promise<void> } => ({
      values: (): Promise<void> => Promise.resolve(),
    }),
  } as unknown as ApiContext['db'];

  const context: ApiContext = {
    config,
    db,
    bus: isBusUp
      ? new BusClient({ transport, source: 'api', logger, requestTimeoutMs: 500 })
      : undefined,
    logger,
    authenticator: new Authenticator({ db, secret }),
    challenges: new ChallengeStore(),
    idempotency: new IdempotencyStore(),
    audit: new AuditLog(db, logger),
    events: new EventFanout(logger),
    jwtSecret: secret,
    totpKey: Buffer.from(config.API_TOTP_ENCRYPTION_KEY, 'hex'),
    secretsKey: secretsKeyFrom(config.NEBULA_SECRETS_KEY),

    /**
     * The wall clock.
     *
     * @returns The current moment.
     */
    now: (): Date => new Date(),
  };

  return buildServer(context);
}

/**
 * Mints an access token this server will accept.
 *
 * @param permissions - What it should carry.
 * @returns The bearer header value.
 */
async function bearer(...permissions: string[]): Promise<string> {
  const token = await signAccessToken(
    {
      userId: '00000000-0000-4000-8000-000000000001',
      sessionId: '00000000-0000-4000-8000-000000000002',
      username: 'tester',
      role: 'owner',
      permissions: permissions.map((key) => ({ key, scope: '*', effect: 'allow' })),
    },
    new TextEncoder().encode(ENVIRONMENT.API_JWT_SECRET),
  );

  return `Bearer ${token}`;
}

describe('with the hub answering', () => {
  beforeAll(async () => {
    server = await buildTestServer(true);
  });

  afterAll(async () => {
    stopHub();
    await server.close();
  });

  it('starts a pass on the instance named and says which instances are looking', async () => {
    discovered = [];

    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/devices/discover',
      headers: { authorization: await bearer('device:write') },
      payload: { integrationId: 'bambu-lab-1', timeoutMs: 20_000 },
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({
      scanId: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
      integrationIds: ['bambu-lab-1'],
    });
    expect(discovered).toEqual([{ integrationId: 'bambu-lab-1', timeoutMs: 20_000 }]);
  });

  it('keeps discovery from somebody who may only read', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/devices/discover',
      headers: { authorization: await bearer('device:read') },
      payload: {},
    });

    expect(response.statusCode).toBe(403);
  });

  it('reads what the pass has found', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/api/v1/devices/candidates',
      headers: { authorization: await bearer('device:write') },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      isScanning: true,
      candidates: [{ candidateId: 'scan-1:01P00A000000042', name: 'Bambu Lab P1S' }],
    });
  });

  it('adopts a candidate and answers with what was written', async () => {
    adopted = [];

    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/devices/adopt',
      headers: { authorization: await bearer('device:write') },
      payload: { candidateId: 'scan-1:01P00A000000042', name: 'Workshop printer' },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({
      deviceId: '00000000-0000-4000-8000-000000000010',
      entityIds: ['light.d_01p00a000000042_chamber_light'],
    });
    expect(adopted).toEqual([{ candidateId: 'scan-1:01P00A000000042', name: 'Workshop printer' }]);
  });

  it('says a candidate from an older pass is not there, as a 404', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/devices/adopt',
      headers: { authorization: await bearer('device:write') },
      payload: { candidateId: 'scan-0:gone' },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: { code: 'NOT_FOUND' } });
  });
});

describe('without the bus', () => {
  beforeAll(async () => {
    server = await buildTestServer(false);
  });

  afterAll(async () => {
    stopHub();
    await server.close();
  });

  it('says the bus is away rather than that nothing was found', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/api/v1/devices/candidates',
      headers: { authorization: await bearer('device:write') },
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ error: { code: 'DEVICE_UNAVAILABLE' } });
  });
});
