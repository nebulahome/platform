/**
 * `pnpm --filter @nebula-home/hub discover` - runs a scan and, if asked, adopts what it found.
 *
 * The interface does not drive discovery yet: `hub` serves it over the bus and nothing calls it
 * but the tests. Until the screen exists this is how a device on the bench becomes a device in
 * the registry, and it is a thin client of the same three subjects the screen will use -
 * `discover`, `candidates`, `adopt` - so nothing here is a second path that could drift from
 * the first.
 *
 * ```
 * pnpm --filter @nebula-home/hub discover --instance bambu-lab-1
 * pnpm --filter @nebula-home/hub discover --instance bambu-lab-1 --adopt-all
 * pnpm --filter @nebula-home/hub discover --instance bambu-lab-1 --adopt <candidateId>
 * ```
 *
 * A scan holds a subscription open for its whole timeout. The candidates are printed as they
 * arrive rather than at the end, because a printer that answers in the first second should not
 * make anybody wait thirty for the list.
 */
import { parseArgs } from 'node:util';

import { BusClient, connectBus } from '@nebula-home/bus';
import { loadConfigOrExit } from '@nebula-home/config';
import {
  adoptReplySchema,
  busSubjects,
  candidatesReplySchema,
  discoverReplySchema,
  EXIT_CODES,
  HUB_ADOPT_METHOD,
  HUB_CANDIDATES_METHOD,
  HUB_DISCOVER_METHOD,
  HUB_SERVICE,
  type DiscoveredCandidate,
} from '@nebula-home/contracts';
import { createLogger } from '@nebula-home/logging';

import { hubEnvSchema } from '../config.js';

/** How often the pass is asked what it has found so far. */
const POLL_MS = 1000;

/** What the command line says. */
type Arguments = {
  readonly instance: string;
  readonly timeoutMs: number;
  readonly adopt: string | undefined;
  readonly isAdoptingAll: boolean;
};

/**
 * Reads the command line.
 *
 * @returns What was asked for.
 * @throws {Error} When the instance is missing, which is the one thing there is no default for.
 */
function readArguments(): Arguments {
  // pnpm hands a `--` through to the script verbatim, and npm habits die hard. To `parseArgs` a
  // `--` ends the options, which would turn everything after it into positionals and a refusal.
  const args = process.argv.slice(2);
  const { values } = parseArgs({
    args: args[0] === '--' ? args.slice(1) : args,
    options: {
      instance: { type: 'string' },
      timeout: { type: 'string', default: '30000' },
      adopt: { type: 'string' },
      'adopt-all': { type: 'boolean', default: false },
    },
  });

  if (values.instance === undefined) {
    throw new Error('--instance <id> is required: the integration instance to scan with');
  }

  return {
    instance: values.instance,
    timeoutMs: Number(values.timeout),
    adopt: values.adopt,
    isAdoptingAll: values['adopt-all'],
  };
}

/**
 * Waits.
 *
 * @param ms - For how long.
 * @returns A promise that settles afterwards.
 */
async function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Says what a candidate is, on one line.
 *
 * @param candidate - What the scan found.
 * @returns The line.
 */
function describe(candidate: DiscoveredCandidate): string {
  const entities = candidate.entities.map((entity) => entity.entityId).join(', ');
  const model = candidate.model === undefined ? '' : ` ${candidate.model}`;

  return `${candidate.candidateId}  ${candidate.externalId}  ${candidate.name}${model}  [${entities}]`;
}

/**
 * Runs the scan and reports.
 *
 * @returns A promise that settles when the pass is over and any adoptions are done.
 */
async function main(): Promise<void> {
  const config = loadConfigOrExit(hubEnvSchema);
  const options = readArguments();
  const logger = createLogger({
    service: 'hub-discover',
    version: '0.0.0',
    level: 'warn',
    pretty: true,
  });

  const bus = await connectBus({
    url: config.NATS_URL,
    name: 'hub-discover',
    logger,
    signal: new AbortController().signal,
  });

  const client = new BusClient({
    transport: bus.transport,
    source: 'hub-discover',
    logger,
    requestTimeoutMs: 10_000,
  });

  try {
    const started = await client.request(
      busSubjects.service(HUB_SERVICE, HUB_DISCOVER_METHOD),
      { integrationId: options.instance, timeoutMs: options.timeoutMs },
      discoverReplySchema,
    );

    if (started.integrationIds.length === 0) {
      process.stdout.write(
        `Nothing is scanning: ${options.instance} is not running. Is it enabled, and did hub start it?\n`,
      );

      return;
    }

    process.stdout.write(
      `Scanning with ${started.integrationIds.join(', ')} for ${String(options.timeoutMs)} ms…\n`,
    );

    const seen = new Set<string>();
    let candidates: DiscoveredCandidate[] = [];
    let isScanning = true;

    while (isScanning) {
      // eslint-disable-next-line no-await-in-loop -- a poll is sequential by nature
      await delay(POLL_MS);

      // eslint-disable-next-line no-await-in-loop -- as above
      const reply = await client.request(
        busSubjects.service(HUB_SERVICE, HUB_CANDIDATES_METHOD),
        {},
        candidatesReplySchema,
      );

      candidates = reply.candidates;
      isScanning = reply.isScanning;

      for (const candidate of candidates) {
        if (!seen.has(candidate.candidateId)) {
          seen.add(candidate.candidateId);
          process.stdout.write(`found  ${describe(candidate)}\n`);
        }
      }
    }

    if (candidates.length === 0) {
      process.stdout.write('The pass ended with nothing claimed.\n');

      return;
    }

    const chosen = options.isAdoptingAll
      ? candidates
      : candidates.filter((candidate) => candidate.candidateId === options.adopt);

    if (options.adopt !== undefined && chosen.length === 0) {
      process.stdout.write(`No candidate ${options.adopt} in this pass.\n`);
      process.exitCode = EXIT_CODES.UNHANDLED_ERROR;

      return;
    }

    for (const candidate of chosen) {
      // eslint-disable-next-line no-await-in-loop -- adoptions are reported one at a time
      const adopted = await client.request(
        busSubjects.service(HUB_SERVICE, HUB_ADOPT_METHOD),
        { candidateId: candidate.candidateId },
        adoptReplySchema,
      );

      process.stdout.write(
        `adopted  ${candidate.externalId} as device ${adopted.deviceId}\n         ${adopted.entityIds.join('\n         ')}\n`,
      );
    }
  } finally {
    await bus.close();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(EXIT_CODES.UNHANDLED_ERROR);
});
