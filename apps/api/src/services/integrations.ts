/**
 * Integrations: the vendors the hub offers and what an owner gave each - and the pieces the
 * device paths are built from.
 *
 * The shape of a configuration is the bundle's to declare and this service's to enforce. It is
 * fetched from the hub - the catalogue, one bus request - and applied twice: to what a client
 * sends, before anything is written, and to what is stored, before anything is served. In
 * between, the bundle's constants are added and the values it declared secret are sealed, so
 * that the row is complete and readable except for the one field nobody should read. Devices
 * are written by `services/devices.ts` with exactly these pieces.
 *
 * A vendor's own settings - the API key a cloud vendor asks for once - are kept the same way in
 * a row of their own, and layered under each device twice: when a configuration is tried, and
 * by the hub, when an instance starts. Neither copies them into the device's row, so a changed
 * key changes every device at its next start.
 *
 * The hub is told after every write to a connection. It re-reads the row and matches it, and
 * its answer - where the instance ended up - is what the interface shows. A hub that does not
 * answer does not fail the write: the row is saved and the instance will start with the hub,
 * and the view says so by carrying the state the row has.
 */
import { eq, sql } from 'drizzle-orm';

import type { BusClient } from '@nebula-home/bus';
import {
  asksAnythingRequired,
  busSubjects,
  catalogueReplySchema,
  ConflictError,
  DeviceUnavailableError,
  HUB_CATALOGUE_METHOD,
  HUB_RELOAD_METHOD,
  HUB_SERVICE,
  integrationVendorViewSchema,
  modelChoicesOf,
  NotFoundError,
  reloadReplySchema,
  secretKeysOf,
  setupValueSchema,
  ValidationError,
  type IntegrationKind,
  type IntegrationSetup,
  type IntegrationVendor,
  type IntegrationVendorConfigUpdate,
  type IntegrationVendorView,
  type JsonObject,
  type SetupValueMode,
} from '@nebula-home/contracts';
import { maskSealed, schema, sealSecrets, type Database } from '@nebula-home/db';
import type { PlatformLogger } from '@nebula-home/logging';

/** The two documents a configuration is made of. */
export type SetupValues = {
  readonly transportConfig: JsonObject;
  readonly options: JsonObject;
};

/** What the write paths need. */
export type IntegrationsContext = {
  readonly db: Database;

  /** Undefined while the broker is unreachable, in which case nothing that needs the hub works. */
  readonly bus: BusClient | undefined;

  /** Seals what a client typed into a secret field. */
  readonly secretsKey: Buffer;

  readonly logger: PlatformLogger;

  /** How long to wait for the hub's catalogue and probe. */
  readonly timeoutMs: number;

  /** The request's trace id, carried onto the bus. */
  readonly traceId: string;
};

/**
 * How long the hub has to stop an instance and, for a reload, start it again and say where it
 * ended up. Stopping waits for a running identification to end, which the hub cuts short.
 */
export const HUB_CALL_TIMEOUT_MS = 15_000;

/**
 * The keys a configuration must not be served with in the clear.
 *
 * By name rather than by bundle, so a row written by hand - or by a transport this service has
 * never heard of - still has its password withheld. Matched case-insensitively and by substring,
 * because the same secret is `password`, `apiKey` and `access_token` depending on who wrote it.
 * A value the bundle declared secret never reaches this check: it is sealed, and served as a
 * flag.
 */
const SECRET_KEYS = ['password', 'secret', 'token', 'apikey', 'api_key', 'credential'];

/**
 * The same configuration, with anything that looks like a secret taken out.
 *
 * Removed rather than replaced with stars: a placeholder is a value, and a form that sent it
 * back would write the placeholder into the row. What the caller gets is a configuration missing
 * its secrets, and a `PATCH` merges rather than replaces, so leaving them out preserves them.
 *
 * @param config - What the row holds.
 * @returns What is safe to serve.
 */
export function withoutSecrets(config: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(config).filter(([key]) => !looksSecret(key)));
}

/**
 * Whether a key is one a secret tends to be stored under.
 *
 * @param key - A configuration key.
 * @returns True when it contains any of {@link SECRET_KEYS}, in any case.
 */
function looksSecret(key: string): boolean {
  return SECRET_KEYS.some((secret) => key.toLowerCase().includes(secret));
}

/**
 * Whatever a `jsonb` column held, as an object.
 *
 * Drizzle types the column `unknown`, and rightly: the row can hold anything JSON can express,
 * including `null` and a bare number. A configuration that is not an object is a row somebody
 * wrote by hand, and treating it as empty is better than throwing on the page that would have
 * shown them the problem.
 *
 * @param value - What the column held.
 * @returns Its fields, or none.
 */
export function asObject(value: unknown): JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as JsonObject)
    : {};
}

/**
 * A stored configuration as the interface may see it.
 *
 * A sealed value becomes `{ "$sealed": true }` - the form learns a secret is kept and nothing
 * else - and anything plain with a secret-looking name is removed outright.
 *
 * @param value - What the column held.
 * @returns What is safe to serve.
 */
export function servedConfig(value: unknown): JsonObject {
  const served: JsonObject = {};

  for (const [key, entry] of Object.entries(maskSealed(asObject(value)))) {
    if (isMask(entry) || !looksSecret(key)) {
      served[key] = entry;
    }
  }

  return served;
}

/**
 * Whether a served value is the flag standing in for a sealed secret.
 *
 * @param value - An entry of a masked document.
 * @returns True for `{ "$sealed": true }`.
 */
function isMask(value: unknown): boolean {
  return (
    typeof value === 'object' && value !== null && '$sealed' in value && value.$sealed === true
  );
}

/**
 * Checks two documents against a declaration.
 *
 * @param setup - What the bundle asks.
 * @param values - What the client sent.
 * @param mode - Whole configuration or change.
 * @returns The values, typed and - for a whole configuration - with declared defaults filled.
 * @throws {ValidationError} With one issue per offending field, its path naming the group, so a
 * form can put the message under the right control.
 */
export function validateSetup(
  setup: IntegrationSetup,
  values: SetupValues,
  mode: SetupValueMode,
): SetupValues {
  const transport = setupValueSchema(setup.transport, mode).safeParse(values.transportConfig);
  const options = setupValueSchema(setup.options, mode).safeParse(values.options);

  if (!transport.success || !options.success) {
    const issues = [
      ...(transport.success
        ? []
        : transport.error.issues.map((issue) => ['transportConfig', issue] as const)),
      ...(options.success ? [] : options.error.issues.map((issue) => ['options', issue] as const)),
    ].map(([group, issue]) => ({
      path: [group, ...issue.path.map(String)].join('.'),
      message: issue.message,
    }));

    throw new ValidationError('The configuration is not what the bundle asks for', {
      details: { issues },
    });
  }

  return { transportConfig: transport.data, options: options.data };
}

/**
 * Turns validated values into what a row holds.
 *
 * The declaration's constants go in beside them - written by this service and refused from a
 * client, so a row is complete on its own and the bundle stays the only author of its fixed
 * values - and every value declared secret is sealed. A value already sealed is carried
 * through: a change merged over a stored row keeps the row's markers.
 *
 * @param setup - What the bundle asks.
 * @param values - As {@link validateSetup} returned them, possibly merged over a stored row.
 * @param secretsKey - The installation's key.
 * @returns The two documents to store.
 */
export function forStorage(
  setup: IntegrationSetup,
  values: SetupValues,
  secretsKey: Buffer,
): SetupValues {
  return {
    transportConfig: sealSecrets(
      { ...setup.transport.constants, ...values.transportConfig },
      secretKeysOf(setup.transport),
      secretsKey,
    ),
    options: sealSecrets(
      { ...setup.options.constants, ...values.options },
      secretKeysOf(setup.options),
      secretsKey,
    ),
  };
}

/**
 * What a probe is sent, from what it is made of.
 *
 * Lowest to highest: what the driver fixes for every device, what the owner gave the vendor
 * once, what this instance already has sealed, and what the form just sent. The same order the
 * hub uses when it starts an instance, so what is tried is what would run.
 *
 * @param constants - The driver's transport constants.
 * @param vendor - The vendor's saved transport settings, sealed values and all.
 * @param kept - The instance's sealed secrets, for the blanks the form left.
 * @param typed - What the form sent, checked.
 * @returns The transport configuration to try.
 */
export function layeredTransportConfig(
  constants: JsonObject,
  vendor: JsonObject,
  kept: JsonObject,
  typed: JsonObject,
): JsonObject {
  return { ...constants, ...vendor, ...kept, ...typed };
}

/** What the vendor's row holds, as this service reads it. */
export type VendorRow = {
  readonly transportConfig: unknown;
  readonly options: unknown;
  readonly updatedAt: Date;
};

/** What has come in through one vendor. */
export type VendorCounts = {
  readonly devices: number;
  readonly entities: number;
};

/**
 * A vendor as the interface sees it: the catalogue entry with what the owner has done about it.
 *
 * @param vendor - As the hub lists it.
 * @param saved - The vendor's row, when the owner has saved its settings.
 * @param counts - What has come in through it.
 * @returns The view.
 */
export function vendorViewOf(
  vendor: IntegrationVendor,
  saved: VendorRow | undefined,
  counts: VendorCounts,
): IntegrationVendorView {
  return integrationVendorViewSchema.parse({
    ...vendor,
    needsSetup: saved === undefined && asksAnythingRequired(vendor.setup),
    isConfigured: saved !== undefined,
    transportConfig: servedConfig(saved?.transportConfig),
    options: servedConfig(saved?.options),
    configuredAt: saved?.updatedAt ?? null,
    deviceCount: counts.devices,
    entityCount: counts.entities,
  });
}

/**
 * Checks that a model is one the driver offers.
 *
 * The pick is what the vendor page shows for the row, so a label the bundle never made a
 * choice of - a typo, a model from another driver - is refused rather than written.
 *
 * @param vendor - The vendor, whose drivers say what may be picked.
 * @param kind - Which driver.
 * @param model - What the client picked.
 * @returns The model, as accepted.
 * @throws {ValidationError} Naming the field and listing the choices, when it is not offered.
 */
export function checkModel(vendor: IntegrationVendor, kind: string, model: string): string {
  const choices = modelChoicesOf(vendor)
    .filter((choice) => choice.kind === kind)
    .map((choice) => choice.model);

  if (!choices.includes(model)) {
    throw new ValidationError('The model is not one this driver offers', {
      details: {
        issues: [{ path: 'model', message: `Must be one of ${choices.join(', ')}` }],
        choices,
      },
    });
  }

  return model;
}

/**
 * The vendor half of a kind.
 *
 * @param kind - As `vendor/driver`.
 * @returns The vendor id.
 */
export function vendorIdOf(kind: string): string {
  return kind.split('/')[0] ?? kind;
}

/**
 * The driver half of a kind.
 *
 * @param kind - As `vendor/driver`.
 * @returns The driver id.
 */
export function driverIdOf(kind: string): string {
  return kind.split('/')[1] ?? kind;
}

/**
 * The bus, or the reason there is none.
 *
 * @param context - The request's collaborators.
 * @returns The client.
 * @throws {DeviceUnavailableError} While the broker is unreachable. Nothing below can be done
 * without the hub: it holds the bundles, and the bundles hold the shape of what is being written.
 */
export function busOf(context: IntegrationsContext): BusClient {
  if (context.bus === undefined) {
    throw new DeviceUnavailableError('The message bus is not reachable', {
      details: { dependency: 'bus' },
    });
  }

  return context.bus;
}

/**
 * Asks the hub what vendors it has loaded.
 *
 * @param context - The request's collaborators.
 * @returns Every vendor, with its drivers and what setting up each asks.
 * @throws {DeviceUnavailableError} When the bus is away or the hub does not answer.
 */
export async function listCatalogue(context: IntegrationsContext): Promise<IntegrationVendor[]> {
  const reply = await busOf(context).request(
    busSubjects.service(HUB_SERVICE, HUB_CATALOGUE_METHOD),
    {},
    catalogueReplySchema,
    { traceId: context.traceId, timeoutMs: context.timeoutMs },
  );

  return reply.vendors;
}

/**
 * The catalogue, or nothing when the hub is away.
 *
 * For the reads that can do without it: a list of instances is still a list without the
 * drivers' names, and a page that showed nothing because the hub was restarting would be worse
 * than one that showed the ids.
 *
 * @param context - The request's collaborators.
 * @returns Every vendor, or none.
 */
export async function catalogueIfUp(context: IntegrationsContext): Promise<IntegrationVendor[]> {
  if (context.bus === undefined) {
    return [];
  }

  try {
    return await listCatalogue(context);
  } catch (error: unknown) {
    context.logger.warn({ err: error }, 'The hub did not answer for its catalogue');

    return [];
  }
}

/**
 * One vendor, as the hub lists it.
 *
 * @param context - The request's collaborators.
 * @param vendorId - Which vendor.
 * @returns The vendor.
 * @throws {NotFoundError} When the hub has no such vendor loaded.
 */
async function vendorOf(
  context: IntegrationsContext,
  vendorId: string,
): Promise<IntegrationVendor> {
  const found = (await listCatalogue(context)).find((each) => each.id === vendorId);

  if (found === undefined) {
    throw new NotFoundError('No bundle is by that vendor', { details: { vendorId } });
  }

  return found;
}

/**
 * One driver and its vendor, as the hub lists them.
 *
 * @param context - The request's collaborators.
 * @param kind - The driver, as `vendor/driver`.
 * @returns Both.
 * @throws {NotFoundError} When the hub has no such driver loaded.
 */
export async function kindOf(
  context: IntegrationsContext,
  kind: string,
): Promise<{ readonly vendor: IntegrationVendor; readonly driver: IntegrationKind }> {
  for (const vendor of await listCatalogue(context)) {
    const driver = vendor.drivers.find((each) => each.id === kind);

    if (driver !== undefined) {
      return { vendor, driver };
    }
  }

  throw new NotFoundError('No bundle has that kind', { details: { kind } });
}

/**
 * Reads one vendor's row.
 *
 * @param db - The database.
 * @param vendorId - Which vendor.
 * @returns The row, or undefined when the owner has saved nothing for it.
 */
export async function vendorRowOf(db: Database, vendorId: string): Promise<VendorRow | undefined> {
  const [row] = await db
    .select({
      transportConfig: schema.registry.integrationVendors.transportConfig,
      options: schema.registry.integrationVendors.options,
      updatedAt: schema.registry.integrationVendors.updatedAt,
    })
    .from(schema.registry.integrationVendors)
    .where(eq(schema.registry.integrationVendors.id, vendorId))
    .limit(1);

  return row;
}

/**
 * Refuses to add a device of a vendor nobody has set up.
 *
 * Only asked of a vendor that asks for something required: for the rest there is nothing to
 * refuse over, and the row is never read.
 *
 * @param context - The request's collaborators.
 * @param vendor - The vendor.
 * @returns A promise that settles when the vendor is ready for a device.
 * @throws {ConflictError} When the vendor still needs setting up.
 */
export async function requireVendorSetup(
  context: IntegrationsContext,
  vendor: IntegrationVendor,
): Promise<void> {
  if (!asksAnythingRequired(vendor.setup)) {
    return;
  }

  if ((await vendorRowOf(context.db, vendor.id)) === undefined) {
    throw new ConflictError(`${vendor.name} needs setting up first`, {
      details: { vendorId: vendor.id, reason: 'needs-setup' },
    });
  }
}

/**
 * What each vendor accounts for: its devices, and the entities they expose.
 *
 * Counted the same way packages are, and for the same reason: "what is this thing doing in my
 * house" is answered by how much of the house it accounts for, not by its version string.
 *
 * @param db - The database.
 * @returns The counts, by vendor id.
 */
async function vendorCounts(db: Database): Promise<Map<string, VendorCounts>> {
  const [instances, entities] = await Promise.all([
    db
      .select({ id: schema.registry.integrations.id, kind: schema.registry.integrations.kind })
      .from(schema.registry.integrations),
    db
      .select({
        integrationId: schema.registry.entities.integrationId,
        total: sql<number>`count(*)::int`,
      })
      .from(schema.registry.entities)
      .groupBy(schema.registry.entities.integrationId),
  ]);
  const entitiesBy = new Map(entities.map((row) => [row.integrationId, row.total]));
  const counts = new Map<string, VendorCounts>();

  for (const instance of instances) {
    const vendorId = vendorIdOf(instance.kind);
    const current = counts.get(vendorId) ?? { devices: 0, entities: 0 };

    counts.set(vendorId, {
      devices: current.devices + 1,
      entities: current.entities + (entitiesBy.get(instance.id) ?? 0),
    });
  }

  return counts;
}

/**
 * Lists every vendor the hub has loaded, with what the owner has done about each.
 *
 * @param context - The request's collaborators.
 * @returns The vendors, in the hub's order.
 * @throws {DeviceUnavailableError} When the bus is away or the hub does not answer.
 */
export async function listVendors(context: IntegrationsContext): Promise<IntegrationVendorView[]> {
  const catalogue = await listCatalogue(context);
  const [saved, counts] = await Promise.all([
    context.db
      .select({
        id: schema.registry.integrationVendors.id,
        transportConfig: schema.registry.integrationVendors.transportConfig,
        options: schema.registry.integrationVendors.options,
        updatedAt: schema.registry.integrationVendors.updatedAt,
      })
      .from(schema.registry.integrationVendors),
    vendorCounts(context.db),
  ]);
  const savedBy = new Map(saved.map((row) => [row.id, row]));

  return catalogue.map((vendor) =>
    vendorViewOf(
      vendor,
      savedBy.get(vendor.id),
      counts.get(vendor.id) ?? { devices: 0, entities: 0 },
    ),
  );
}

/**
 * Reads one vendor, or says it is not there.
 *
 * @param context - The request's collaborators.
 * @param vendorId - Which vendor.
 * @returns The vendor.
 * @throws {NotFoundError} When the hub has no such vendor loaded.
 */
export async function readVendor(
  context: IntegrationsContext,
  vendorId: string,
): Promise<IntegrationVendorView> {
  const found = (await listVendors(context)).find((one) => one.id === vendorId);

  if (found === undefined) {
    throw new NotFoundError('No bundle is by that vendor', { details: { vendorId } });
  }

  return found;
}

/**
 * Asks the hub to match an instance to its row.
 *
 * Best effort. A hub that does not answer - stopped, restarting, mid-scan for fifteen seconds -
 * is logged and left to pick the row up when it next starts; the write it was asked about has
 * already happened and is not undone by a silence.
 *
 * @param context - The request's collaborators.
 * @param id - Which instance.
 * @returns A promise that settles once the hub has answered or been given up on.
 */
export async function reloadOnHub(context: IntegrationsContext, id: string): Promise<void> {
  if (context.bus === undefined) {
    return;
  }

  try {
    await context.bus.request(
      busSubjects.service(HUB_SERVICE, HUB_RELOAD_METHOD),
      { integrationId: id },
      reloadReplySchema,
      { traceId: context.traceId, timeoutMs: HUB_CALL_TIMEOUT_MS },
    );
  } catch (error: unknown) {
    context.logger.warn(
      { integrationId: id, err: error },
      'The hub did not apply the change; it will on its next start',
    );
  }
}

/**
 * Saves a vendor's settings and has every instance of it start again with them.
 *
 * Merged over what is stored, as an instance's change is: the form was served the settings
 * with their secrets withheld, and a secret left out keeps its seal. The first save is checked
 * as a whole configuration, so a required key cannot be skipped; a later one as a change.
 *
 * @param context - The request's collaborators.
 * @param vendorId - Which vendor.
 * @param body - What the form collected.
 * @returns The vendor as it now stands.
 * @throws {NotFoundError} When the hub has no such vendor loaded.
 * @throws {ValidationError} When the settings are not what the vendor asks.
 */
export async function updateVendorConfig(
  context: IntegrationsContext,
  vendorId: string,
  body: IntegrationVendorConfigUpdate,
): Promise<IntegrationVendorView> {
  const vendor = await vendorOf(context, vendorId);
  const current = await vendorRowOf(context.db, vendorId);
  const change = validateSetup(
    vendor.setup,
    { transportConfig: body.transportConfig ?? {}, options: body.options ?? {} },
    current === undefined ? 'complete' : 'partial',
  );
  const stored = forStorage(
    vendor.setup,
    {
      transportConfig: { ...asObject(current?.transportConfig), ...change.transportConfig },
      options: { ...asObject(current?.options), ...change.options },
    },
    context.secretsKey,
  );

  await context.db
    .insert(schema.registry.integrationVendors)
    .values({
      id: vendorId,
      version: vendor.version,
      transportConfig: stored.transportConfig,
      options: stored.options,
    })
    .onConflictDoUpdate({
      target: schema.registry.integrationVendors.id,
      set: {
        version: vendor.version,
        transportConfig: stored.transportConfig,
        options: stored.options,
        updatedAt: new Date(),
      },
    });

  // Every instance of the vendor runs with the old settings until it starts again, and the
  // owner just changed them because the old ones were wrong.
  const instances = await context.db
    .select({ id: schema.registry.integrations.id, kind: schema.registry.integrations.kind })
    .from(schema.registry.integrations);

  await Promise.all(
    instances
      .filter((instance) => vendorIdOf(instance.kind) === vendorId)
      .map(async (instance) => reloadOnHub(context, instance.id)),
  );

  return readVendor(context, vendorId);
}
