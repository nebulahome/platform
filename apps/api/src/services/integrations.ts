/**
 * Integrations: the vendors the hub offers, what an owner gave each, and the instances - devices
 * added by hand - that run under them.
 *
 * The shape of a configuration is the bundle's to declare and this service's to enforce. It is
 * fetched from the hub - the catalogue, one bus request - and applied twice: to what a client
 * sends, before anything is written, and to what is stored, before anything is served. In
 * between, the bundle's constants are added and the values it declared secret are sealed, so
 * that the row is complete and readable except for the one field nobody should read.
 *
 * A vendor's own settings - the API key a cloud vendor asks for once - are kept the same way in
 * a row of their own, and layered under each instance twice: here, when a configuration is
 * tried, and by the hub, when an instance starts. Neither copies them into the instance row, so
 * a changed key changes every device at its next start.
 *
 * The hub is told after every write. It re-reads the row and matches it, and its answer - where
 * the instance ended up - is what the interface shows. A hub that does not answer does not fail
 * the write: the row is saved and the instance will start with the hub, and the view says so by
 * carrying the state the row has.
 */
import { asc, eq, sql } from 'drizzle-orm';

import type { BusClient } from '@nebula-home/bus';
import {
  asksAnythingRequired,
  busSubjects,
  catalogueReplySchema,
  ConflictError,
  DeviceUnavailableError,
  HUB_CATALOGUE_METHOD,
  HUB_PROBE_METHOD,
  HUB_RELOAD_METHOD,
  HUB_SERVICE,
  integrationVendorViewSchema,
  integrationViewSchema,
  modelChoicesOf,
  NotFoundError,
  probeReplySchema,
  reloadReplySchema,
  secretKeysOf,
  setupValueSchema,
  ValidationError,
  type IntegrationCreate,
  type IntegrationKind,
  type IntegrationProbeReply,
  type IntegrationProbeRequest,
  type IntegrationSetup,
  type IntegrationUpdate,
  type IntegrationVendor,
  type IntegrationVendorConfigUpdate,
  type IntegrationVendorView,
  type IntegrationView,
  type JsonObject,
  type SetupValueMode,
} from '@nebula-home/contracts';
import { isSealed, maskSealed, schema, sealSecrets, type Database } from '@nebula-home/db';
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

/** How long the hub has to restart an instance and say where it ended up. */
const RELOAD_TIMEOUT_MS = 15_000;

/** How long a probe may take, end to end, on the hub's side. */
const PROBE_TIMEOUT_MS = 8000;

/** The margin the bus request waits beyond the probe itself. */
const PROBE_MARGIN_MS = 2000;

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
function asObject(value: unknown): JsonObject {
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
  readonly instances: number;
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
    instanceCount: counts.instances,
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
function vendorIdOf(kind: string): string {
  return kind.split('/')[0] ?? kind;
}

/**
 * The driver half of a kind.
 *
 * @param kind - As `vendor/driver`.
 * @returns The driver id.
 */
function driverIdOf(kind: string): string {
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
function busOf(context: IntegrationsContext): BusClient {
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
async function catalogueIfUp(context: IntegrationsContext): Promise<IntegrationVendor[]> {
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
async function kindOf(
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
async function vendorRowOf(db: Database, vendorId: string): Promise<VendorRow | undefined> {
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
async function requireVendorSetup(
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

/** One instance row with what it owns, before the catalogue names its driver. */
type InstanceRow = {
  readonly id: string;
  readonly kind: string;
  readonly kindVersion: string;
  readonly model: string | null;
  readonly transport: string;
  readonly transportConfig: unknown;
  readonly options: unknown;
  readonly isEnabled: boolean;
  readonly state: string;
  readonly lastError: string | null;
  readonly lastStartedAt: Date | null;
  readonly deviceCount: number;
  readonly entityCount: number;
};

/**
 * Every instance row, with what each has adopted.
 *
 * Counted the same way packages are, and for the same reason: "what is this thing doing in my
 * house" is answered by how much of the house it accounts for, not by its version string.
 *
 * @param db - The database.
 * @returns The rows, by id.
 */
async function instanceRows(db: Database): Promise<InstanceRow[]> {
  const rows = await db
    .select({
      id: schema.registry.integrations.id,
      kind: schema.registry.integrations.kind,
      kindVersion: schema.registry.integrations.kindVersion,
      model: schema.registry.integrations.model,
      transport: schema.registry.integrations.transport,
      transportConfig: schema.registry.integrations.transportConfig,
      options: schema.registry.integrations.options,
      isEnabled: schema.registry.integrations.isEnabled,
      state: schema.registry.integrations.state,
      lastError: schema.registry.integrations.lastError,
      lastStartedAt: schema.registry.integrations.lastStartedAt,
    })
    .from(schema.registry.integrations)
    .orderBy(asc(schema.registry.integrations.id));

  const devices = await db
    .select({
      integrationId: schema.registry.devices.integrationId,
      total: sql<number>`count(*)::int`,
    })
    .from(schema.registry.devices)
    .groupBy(schema.registry.devices.integrationId);

  const entities = await db
    .select({
      integrationId: schema.registry.entities.integrationId,
      total: sql<number>`count(*)::int`,
    })
    .from(schema.registry.entities)
    .groupBy(schema.registry.entities.integrationId);

  const devicesBy = new Map(devices.map((row) => [row.integrationId, row.total]));
  const entitiesBy = new Map(entities.map((row) => [row.integrationId, row.total]));

  return rows.map((row) => ({
    ...row,
    deviceCount: devicesBy.get(row.id) ?? 0,
    entityCount: entitiesBy.get(row.id) ?? 0,
  }));
}

/**
 * One instance as the interface sees it.
 *
 * @param row - The row, with its counts.
 * @param catalogue - What the hub has loaded, for the driver's name; may be empty.
 * @returns The view.
 */
function integrationViewOf(
  row: InstanceRow,
  catalogue: readonly IntegrationVendor[],
): IntegrationView {
  const driver = catalogue.flatMap((vendor) => vendor.drivers).find((each) => each.id === row.kind);

  return integrationViewSchema.parse({
    ...row,
    vendorId: vendorIdOf(row.kind),
    driverId: driverIdOf(row.kind),
    driverName: driver?.name ?? driverIdOf(row.kind),
    transportConfig: servedConfig(row.transportConfig),
    options: servedConfig(row.options),
  });
}

/**
 * Lists every configured instance, with what each one has adopted.
 *
 * @param context - The request's collaborators.
 * @returns The instances, by id.
 */
export async function listIntegrations(context: IntegrationsContext): Promise<IntegrationView[]> {
  const [rows, catalogue] = await Promise.all([instanceRows(context.db), catalogueIfUp(context)]);

  return rows.map((row) => integrationViewOf(row, catalogue));
}

/**
 * Reads one instance, or says it is not there.
 *
 * @param context - The request's collaborators.
 * @param id - Which one.
 * @returns The instance.
 * @throws {NotFoundError} When no instance has that id.
 */
export async function readIntegration(
  context: IntegrationsContext,
  id: string,
): Promise<IntegrationView> {
  const found = (await listIntegrations(context)).find((one) => one.id === id);

  if (found === undefined) {
    throw new NotFoundError('No integration has that id', { details: { id } });
  }

  return found;
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
  const [saved, instances] = await Promise.all([
    context.db
      .select({
        id: schema.registry.integrationVendors.id,
        transportConfig: schema.registry.integrationVendors.transportConfig,
        options: schema.registry.integrationVendors.options,
        updatedAt: schema.registry.integrationVendors.updatedAt,
      })
      .from(schema.registry.integrationVendors),
    instanceRows(context.db),
  ]);
  const savedBy = new Map(saved.map((row) => [row.id, row]));

  return catalogue.map((vendor) => {
    const own = instances.filter((row) => vendorIdOf(row.kind) === vendor.id);

    return vendorViewOf(vendor, savedBy.get(vendor.id), {
      instances: own.length,
      devices: own.reduce((sum, row) => sum + row.deviceCount, 0),
      entities: own.reduce((sum, row) => sum + row.entityCount, 0),
    });
  });
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
async function reloadOnHub(context: IntegrationsContext, id: string): Promise<void> {
  if (context.bus === undefined) {
    return;
  }

  try {
    await context.bus.request(
      busSubjects.service(HUB_SERVICE, HUB_RELOAD_METHOD),
      { integrationId: id },
      reloadReplySchema,
      { traceId: context.traceId, timeoutMs: RELOAD_TIMEOUT_MS },
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

/**
 * Creates an instance - a device added by hand - and asks the hub to start it.
 *
 * @param context - The request's collaborators.
 * @param body - What the form collected.
 * @returns The instance as it now stands, its state as the hub reported it.
 * @throws {NotFoundError} When the kind is not loaded.
 * @throws {ConflictError} When the vendor still needs setting up, or an instance already has
 * that id.
 * @throws {ValidationError} When the model is not one the driver offers, or the configuration
 * is not what the driver asks.
 */
export async function createIntegration(
  context: IntegrationsContext,
  body: IntegrationCreate,
): Promise<IntegrationView> {
  const { vendor, driver } = await kindOf(context, body.kind);
  const model = checkModel(vendor, driver.id, body.model);
  const values = validateSetup(driver.setup, body, 'complete');
  const stored = forStorage(driver.setup, values, context.secretsKey);

  await requireVendorSetup(context, vendor);

  const [existing] = await context.db
    .select({ id: schema.registry.integrations.id })
    .from(schema.registry.integrations)
    .where(eq(schema.registry.integrations.id, body.id))
    .limit(1);

  if (existing !== undefined) {
    throw new ConflictError('An integration already has that id', { details: { id: body.id } });
  }

  await context.db.insert(schema.registry.integrations).values({
    id: body.id,
    kind: driver.id,
    kindVersion: vendor.version,
    model,
    transport: driver.transport,
    transportConfig: stored.transportConfig,
    options: stored.options,
    isEnabled: body.isEnabled,
  });

  await reloadOnHub(context, body.id);

  return readIntegration(context, body.id);
}

/**
 * Changes an instance's configuration and asks the hub to match it.
 *
 * Merged rather than replaced. The caller was served a configuration with its secrets withheld,
 * so a whole-document write would send back what it was given and delete the password on the
 * way through - the one failure this endpoint could cause that nobody would notice until the
 * next restart. A secret field sent again is sealed afresh; one left out keeps its marker.
 *
 * Configuration only, and deliberately: `state`, `lastError` and `lastStartedAt` belong to the
 * hub. The database would in fact allow this role to write them - the column-level grant
 * DATABASE.md describes is not what the migration actually applied - so the restriction is kept
 * here, where it is at least visible.
 *
 * @param context - The request's collaborators.
 * @param id - Which one.
 * @param body - The fields to change.
 * @returns The instance as it now stands.
 * @throws {NotFoundError} When no instance has that id, or its kind is no longer loaded.
 * @throws {ValidationError} When the change is not what the driver asks, or the model is not
 * one it offers.
 */
export async function updateIntegration(
  context: IntegrationsContext,
  id: string,
  body: IntegrationUpdate,
): Promise<IntegrationView> {
  const [current] = await context.db
    .select({
      kind: schema.registry.integrations.kind,
      transportConfig: schema.registry.integrations.transportConfig,
      options: schema.registry.integrations.options,
    })
    .from(schema.registry.integrations)
    .where(eq(schema.registry.integrations.id, id))
    .limit(1);

  if (current === undefined) {
    throw new NotFoundError('No integration has that id', { details: { id } });
  }

  const isChangingConfig = body.transportConfig !== undefined || body.options !== undefined;
  const needsBundle = isChangingConfig || body.model !== undefined;
  const found = needsBundle ? await kindOf(context, current.kind) : undefined;
  const model =
    body.model === undefined || found === undefined
      ? undefined
      : checkModel(found.vendor, found.driver.id, body.model);
  const stored =
    isChangingConfig && found !== undefined
      ? mergedForStorage(context, found.driver, current, body)
      : { transportConfig: asObject(current.transportConfig), options: asObject(current.options) };

  await context.db
    .update(schema.registry.integrations)
    .set({
      ...(body.isEnabled === undefined ? {} : { isEnabled: body.isEnabled }),
      ...(model === undefined ? {} : { model }),
      transportConfig: stored.transportConfig,
      options: stored.options,
      updatedAt: new Date(),
    })
    .where(eq(schema.registry.integrations.id, id));

  await reloadOnHub(context, id);

  return readIntegration(context, id);
}

/** What a row holds that a change is merged over. */
type StoredRow = {
  readonly kind: string;
  readonly transportConfig: unknown;
  readonly options: unknown;
};

/**
 * A change checked against the driver and merged over what the row holds.
 *
 * @param context - The request's collaborators.
 * @param driver - The driver the row's kind names.
 * @param current - The row's documents.
 * @param body - The change.
 * @returns The two documents to store.
 */
function mergedForStorage(
  context: IntegrationsContext,
  driver: IntegrationKind,
  current: StoredRow,
  body: IntegrationUpdate,
): SetupValues {
  const change = validateSetup(
    driver.setup,
    { transportConfig: body.transportConfig ?? {}, options: body.options ?? {} },
    'partial',
  );

  return forStorage(
    driver.setup,
    {
      transportConfig: { ...asObject(current.transportConfig), ...change.transportConfig },
      options: { ...asObject(current.options), ...change.options },
    },
    context.secretsKey,
  );
}

/**
 * Tries a configuration against the world, keeping nothing.
 *
 * For an instance being edited, a secret left blank in the form is filled from what the row has
 * sealed - the hub opens it - so testing a changed address does not mean typing the password
 * again. The driver's constants and the vendor's saved settings are added the way they would
 * be when the instance starts, so what is tried is what would run.
 *
 * @param context - The request's collaborators.
 * @param body - Which driver, what to try, and which instance the blanks come from.
 * @returns The hub's verdict and its sentence.
 * @throws {NotFoundError} When the kind is not loaded, or the named instance does not exist.
 * @throws {ValidationError} When the configuration is not what the driver asks.
 */
export async function probeIntegration(
  context: IntegrationsContext,
  body: IntegrationProbeRequest,
): Promise<IntegrationProbeReply> {
  const { vendor, driver } = await kindOf(context, body.kind);
  const typed = validateSetup(
    driver.setup,
    { transportConfig: body.transportConfig, options: {} },
    body.integrationId === undefined ? 'complete' : 'partial',
  );
  const kept =
    body.integrationId === undefined ? {} : await storedSecrets(context, body.integrationId);

  // Read only when the vendor has anything to layer: for the rest there is no row to read and
  // nothing it could hold.
  const saved =
    vendor.setup.transport.fields.length === 0
      ? undefined
      : await vendorRowOf(context.db, vendor.id);

  return busOf(context).request(
    busSubjects.service(HUB_SERVICE, HUB_PROBE_METHOD),
    {
      kind: driver.id,
      transportConfig: layeredTransportConfig(
        driver.setup.transport.constants,
        asObject(saved?.transportConfig),
        kept,
        typed.transportConfig,
      ),
      timeoutMs: PROBE_TIMEOUT_MS,
    },
    probeReplySchema,
    { traceId: context.traceId, timeoutMs: PROBE_TIMEOUT_MS + PROBE_MARGIN_MS },
  );
}

/**
 * The sealed values one instance's row holds, to stand in for the blanks of a probe.
 *
 * Only the sealed ones: everything else the form has and sends, and a plain value from the row
 * would override what was just typed.
 *
 * @param context - The request's collaborators.
 * @param id - Which instance.
 * @returns Its sealed transport values, by key.
 * @throws {NotFoundError} When no integration has that id.
 */
async function storedSecrets(context: IntegrationsContext, id: string): Promise<JsonObject> {
  const [row] = await context.db
    .select({ transportConfig: schema.registry.integrations.transportConfig })
    .from(schema.registry.integrations)
    .where(eq(schema.registry.integrations.id, id))
    .limit(1);

  if (row === undefined) {
    throw new NotFoundError('No integration has that id', { details: { id } });
  }

  return Object.fromEntries(
    Object.entries(asObject(row.transportConfig)).filter(([, value]) => isSealed(value)),
  );
}
