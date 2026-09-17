/**
 * Devices: one thing under one id, read and written as its two halves.
 *
 * The **connection half** is the integration instance - a driver bound to a transport, pointed
 * at an address - which `hub` runs and reports on. The **identity half** is the registry row:
 * what the owner called the device, its icon, and what the hardware said about itself once
 * `hub` heard from it. Adding a device writes both, in one transaction; listing joins them;
 * changing one touches whichever half the change belongs to, and only a change to the
 * connection half is worth telling the hub about.
 *
 * The shape of a configuration is the bundle's to declare and this service's to enforce. It is
 * fetched from the hub - the catalogue, one bus request - and applied twice: to what a client
 * sends, before anything is written, and to what is stored, before anything is served. In
 * between, the bundle's constants are added and the values it declared secret are sealed, so
 * that the row is complete and readable except for the one field nobody should read.
 *
 * The hub is told after every write to the connection half. It re-reads the row and matches it,
 * and its answer - where the instance ended up - is what the interface shows. A hub that does
 * not answer does not fail the write: the row is saved and the instance will start with the
 * hub, and the view says so by carrying the state the row has.
 */
import { asc, eq, inArray, sql } from 'drizzle-orm';

import {
  busSubjects,
  deviceViewSchema,
  ConflictError,
  HUB_PROBE_METHOD,
  HUB_SERVICE,
  NotFoundError,
  probeReplySchema,
  ValidationError,
  type DeviceCreate,
  type DeviceProbeReply,
  type DeviceProbeRequest,
  type DeviceUpdate,
  type DeviceView,
  type IntegrationKind,
  type IntegrationVendor,
  type JsonObject,
} from '@nebula-home/contracts';
import { isSealed, schema } from '@nebula-home/db';

import {
  asObject,
  busOf,
  catalogueIfUp,
  checkModel,
  driverIdOf,
  forStorage,
  kindOf,
  layeredTransportConfig,
  reloadOnHub,
  requireVendorSetup,
  servedConfig,
  validateSetup,
  vendorIdOf,
  vendorRowOf,
  type IntegrationsContext,
  type SetupValues,
} from './integrations.js';

/** Whether an icon id names an icon: the catalogue, as far as this service needs it. */
export type IconLookup = {
  readonly has: (id: string) => boolean;
};

/** What the device paths need. */
export type DevicesContext = IntegrationsContext & {
  /** The icon catalogue, to check what a device is given. */
  readonly icons: IconLookup;
};

/** How long a probe may take, end to end, on the hub's side. */
const PROBE_TIMEOUT_MS = 8000;

/** The margin the bus request waits beyond the probe itself. */
const PROBE_MARGIN_MS = 2000;

/** The two halves as they join, before the catalogue names the driver. */
export type DeviceRow = {
  readonly id: string;
  readonly kind: string;
  readonly kindVersion: string;

  /** The model the owner picked when adding the device. */
  readonly pickedModel: string | null;
  readonly transport: string;
  readonly transportConfig: unknown;
  readonly options: unknown;
  readonly isEnabled: boolean;
  readonly state: string;
  readonly lastError: string | null;
  readonly lastStartedAt: Date | null;

  /** Null for an instance whose identity row is missing: written by hand, before there was one. */
  readonly name: string | null;
  readonly icon: string | null;
  readonly externalId: string | null;
  readonly manufacturer: string | null;

  /** The model the hardware reported, when it has. */
  readonly model: string | null;
  readonly swVersion: string | null;
  readonly hwVersion: string | null;
  readonly areaKey: string | null;
  readonly areaName: string | null;
  readonly lastUpdatedAt: Date | null;
};

/**
 * One device as the interface sees it.
 *
 * @param row - The two halves, joined.
 * @param catalogue - What the hub has loaded, for the driver's name; may be empty.
 * @param entityIds - The addresses of its entities.
 * @returns The view.
 */
export function toDeviceView(
  row: DeviceRow,
  catalogue: readonly IntegrationVendor[],
  entityIds: readonly string[],
): DeviceView {
  const driver = catalogue.flatMap((vendor) => vendor.drivers).find((each) => each.id === row.kind);

  return deviceViewSchema.parse({
    id: row.id,
    name: row.name ?? row.id,
    icon: row.icon,
    kind: row.kind,
    kindVersion: row.kindVersion,
    vendorId: vendorIdOf(row.kind),
    driverId: driverIdOf(row.kind),
    driverName: driver?.name ?? driverIdOf(row.kind),
    model: row.model ?? row.pickedModel,
    transport: row.transport,
    transportConfig: servedConfig(row.transportConfig),
    options: servedConfig(row.options),
    isEnabled: row.isEnabled,
    state: row.state,
    lastError: row.lastError,
    lastStartedAt: row.lastStartedAt,
    lastUpdatedAt: row.lastUpdatedAt,
    externalId: row.externalId,
    manufacturer: row.manufacturer,
    swVersion: row.swVersion,
    hwVersion: row.hwVersion,
    areaKey: row.areaKey,
    areaName: row.areaName,
    entityIds,
  });
}

/**
 * Every device, both halves joined, with the last time one of its entities reported.
 *
 * @param context - The request's collaborators.
 * @returns The rows, by name.
 */
async function deviceRows(context: DevicesContext): Promise<DeviceRow[]> {
  const { integrations, devices, areas, entities, entityStates } = schema.registry;

  const rows = await context.db
    .select({
      id: integrations.id,
      kind: integrations.kind,
      kindVersion: integrations.kindVersion,
      pickedModel: integrations.model,
      transport: integrations.transport,
      transportConfig: integrations.transportConfig,
      options: integrations.options,
      isEnabled: integrations.isEnabled,
      state: integrations.state,
      lastError: integrations.lastError,
      lastStartedAt: integrations.lastStartedAt,
      name: devices.name,
      icon: devices.icon,
      externalId: devices.externalId,
      manufacturer: devices.manufacturer,
      model: devices.model,
      swVersion: devices.swVersion,
      hwVersion: devices.hwVersion,
      areaKey: areas.key,
      areaName: areas.name,
    })
    .from(integrations)
    .leftJoin(devices, eq(devices.integrationId, integrations.id))
    .leftJoin(areas, eq(areas.id, devices.areaId))
    .orderBy(asc(devices.name), asc(integrations.id));

  if (rows.length === 0) {
    return [];
  }

  const updated = await context.db
    .select({
      integrationId: entities.integrationId,
      lastUpdatedAt: sql<Date | null>`max(${entityStates.lastUpdated})`,
    })
    .from(entities)
    .innerJoin(entityStates, eq(entityStates.entityId, entities.id))
    .where(
      inArray(
        entities.integrationId,
        rows.map((row) => row.id),
      ),
    )
    .groupBy(entities.integrationId);
  const updatedBy = new Map(updated.map((row) => [row.integrationId, row.lastUpdatedAt]));

  return rows.map((row) => ({ ...row, lastUpdatedAt: updatedBy.get(row.id) ?? null }));
}

/**
 * The entities of some devices, by device.
 *
 * @param context - The request's collaborators.
 * @param ids - Which devices.
 * @returns Each device's entity addresses.
 */
async function entityIdsOf(
  context: DevicesContext,
  ids: readonly string[],
): Promise<Map<string, string[]>> {
  const byDevice = new Map<string, string[]>();

  if (ids.length === 0) {
    return byDevice;
  }

  const rows = await context.db
    .select({
      integrationId: schema.registry.entities.integrationId,
      entityId: schema.registry.entities.entityId,
    })
    .from(schema.registry.entities)
    .where(inArray(schema.registry.entities.integrationId, [...ids]))
    .orderBy(asc(schema.registry.entities.entityId));

  for (const row of rows) {
    if (row.integrationId !== null) {
      byDevice.set(row.integrationId, [...(byDevice.get(row.integrationId) ?? []), row.entityId]);
    }
  }

  return byDevice;
}

/**
 * Lists every device, with where each stands and what it exposes.
 *
 * @param context - The request's collaborators.
 * @returns The devices, by name.
 */
export async function listDevices(context: DevicesContext): Promise<DeviceView[]> {
  const [rows, catalogue] = await Promise.all([deviceRows(context), catalogueIfUp(context)]);
  const entityIds = await entityIdsOf(
    context,
    rows.map((row) => row.id),
  );

  return rows.map((row) => toDeviceView(row, catalogue, entityIds.get(row.id) ?? []));
}

/**
 * Reads one device, or says it is not there.
 *
 * @param context - The request's collaborators.
 * @param id - Which one.
 * @returns The device.
 * @throws {NotFoundError} When no device has that id.
 */
export async function readDevice(context: DevicesContext, id: string): Promise<DeviceView> {
  const found = (await listDevices(context)).find((one) => one.id === id);

  if (found === undefined) {
    throw new NotFoundError('No device has that id', { details: { id } });
  }

  return found;
}

/**
 * The icon a device starts with: what the owner picked, else the driver's default.
 *
 * What the owner picked must exist - they picked it from the catalogue a moment ago, so a
 * miss is a bug or a stale page, and worth a refusal naming the field. The driver's default
 * is somebody else's word, and an unknown one is worth a warning and no icon, not a device
 * that cannot be added.
 *
 * @param context - The request's collaborators.
 * @param picked - What the owner sent, if anything.
 * @param driver - The driver, whose manifest may name a default.
 * @returns The icon id, or null for none.
 * @throws {ValidationError} When the owner's pick is not in the catalogue.
 */
function iconFor(
  context: DevicesContext,
  picked: string | null | undefined,
  driver: IntegrationKind,
): string | null {
  if (picked !== undefined && picked !== null) {
    checkIcon(context, picked);

    return picked;
  }

  if (picked === null || driver.defaultIcon === undefined) {
    return null;
  }

  if (!context.icons.has(driver.defaultIcon)) {
    context.logger.warn(
      { kind: driver.id, icon: driver.defaultIcon },
      'The driver names a default icon the catalogue does not have; the device gets none',
    );

    return null;
  }

  return driver.defaultIcon;
}

/**
 * Refuses an icon the catalogue does not have.
 *
 * @param context - The request's collaborators.
 * @param icon - The id.
 * @throws {ValidationError} Naming the field.
 */
function checkIcon(context: DevicesContext, icon: string): void {
  if (!context.icons.has(icon)) {
    throw new ValidationError('The icon is not in the catalogue', {
      details: { issues: [{ path: 'icon', message: `No icon has the id ${icon}` }] },
    });
  }
}

/**
 * Adds a device: writes both halves and asks the hub to start listening for it.
 *
 * @param context - The request's collaborators.
 * @param body - What the form collected.
 * @returns The device as it now stands, its state as the hub reported it.
 * @throws {NotFoundError} When the kind is not loaded.
 * @throws {ConflictError} When the vendor still needs setting up, or a device already has
 * that id.
 * @throws {ValidationError} When the model is not one the driver offers, the icon is not in
 * the catalogue, or the configuration is not what the driver asks.
 */
export async function createDevice(
  context: DevicesContext,
  body: DeviceCreate,
): Promise<DeviceView> {
  const { vendor, driver } = await kindOf(context, body.kind);
  const model = checkModel(vendor, driver.id, body.model);
  const values = validateSetup(driver.setup, body, 'complete');
  const stored = forStorage(driver.setup, values, context.secretsKey);
  const icon = iconFor(context, body.icon, driver);

  await requireVendorSetup(context, vendor);

  const [existing] = await context.db
    .select({ id: schema.registry.integrations.id })
    .from(schema.registry.integrations)
    .where(eq(schema.registry.integrations.id, body.id))
    .limit(1);

  if (existing !== undefined) {
    throw new ConflictError('A device already has that id', { details: { id: body.id } });
  }

  // Both halves or neither. A connection without an identity is a device no page can name; an
  // identity without a connection is a row nothing will ever hear from.
  await context.db.transaction(async (tx) => {
    await tx.insert(schema.registry.integrations).values({
      id: body.id,
      kind: driver.id,
      kindVersion: vendor.version,
      model,
      transport: driver.transport,
      transportConfig: stored.transportConfig,
      options: stored.options,
      isEnabled: body.isEnabled,
    });
    // The model the owner picked stays on the connection half; the identity half's `model` is
    // what the hardware reports, once it has, and the view shows whichever it has.
    await tx.insert(schema.registry.devices).values({
      integrationId: body.id,
      externalId: null,
      name: body.name,
      icon,
      manufacturer: vendor.name,
      model: null,
      config: {},
    });
  });

  await reloadOnHub(context, body.id);

  return readDevice(context, body.id);
}

/** What the connection half holds that a change is merged over. */
type StoredRow = {
  readonly kind: string;
  readonly transportConfig: unknown;
  readonly options: unknown;
};

/**
 * A change checked against the driver and merged over what the row holds.
 *
 * Merged rather than replaced. The caller was served a configuration with its secrets withheld,
 * so a whole-document write would send back what it was given and delete the password on the
 * way through. A secret field sent again is sealed afresh; one left out keeps its marker.
 *
 * @param context - The request's collaborators.
 * @param driver - The driver the row's kind names.
 * @param current - The row's documents.
 * @param body - The change.
 * @returns The two documents to store.
 */
function mergedForStorage(
  context: DevicesContext,
  driver: IntegrationKind,
  current: StoredRow,
  body: DeviceUpdate,
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
 * Changes a device: its name and icon on the identity half, its configuration on the
 * connection half - and asks the hub to match the connection half when that changed.
 *
 * `state`, `lastError` and `lastStartedAt` belong to the hub and are never written here.
 *
 * @param context - The request's collaborators.
 * @param id - Which device.
 * @param body - The fields to change.
 * @returns The device as it now stands.
 * @throws {NotFoundError} When no device has that id, or its kind is no longer loaded.
 * @throws {ValidationError} When the change is not what the driver asks, the model is not one
 * it offers, or the icon is not in the catalogue.
 */
export async function updateDevice(
  context: DevicesContext,
  id: string,
  body: DeviceUpdate,
): Promise<DeviceView> {
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
    throw new NotFoundError('No device has that id', { details: { id } });
  }

  if (body.icon !== undefined && body.icon !== null) {
    checkIcon(context, body.icon);
  }

  const isChangingConfig = body.transportConfig !== undefined || body.options !== undefined;
  const isChangingConnection =
    isChangingConfig || body.model !== undefined || body.isEnabled !== undefined;
  const needsBundle = isChangingConfig || body.model !== undefined;
  const found = needsBundle ? await kindOf(context, current.kind) : undefined;
  const model =
    body.model === undefined || found === undefined
      ? undefined
      : checkModel(found.vendor, found.driver.id, body.model);
  const stored =
    isChangingConfig && found !== undefined
      ? mergedForStorage(context, found.driver, current, body)
      : undefined;

  await context.db.transaction(async (tx) => {
    if (body.name !== undefined || body.icon !== undefined) {
      await tx
        .update(schema.registry.devices)
        .set({
          ...(body.name === undefined ? {} : { name: body.name }),
          ...(body.icon === undefined ? {} : { icon: body.icon }),
          updatedAt: new Date(),
        })
        .where(eq(schema.registry.devices.integrationId, id));
    }

    if (isChangingConnection) {
      await tx
        .update(schema.registry.integrations)
        .set({
          ...(body.isEnabled === undefined ? {} : { isEnabled: body.isEnabled }),
          ...(model === undefined ? {} : { model }),
          ...(stored === undefined
            ? {}
            : { transportConfig: stored.transportConfig, options: stored.options }),
          updatedAt: new Date(),
        })
        .where(eq(schema.registry.integrations.id, id));
    }
  });

  // A rename is nobody's business but the registry's; the hub is told only when what it runs
  // has changed.
  if (isChangingConnection) {
    await reloadOnHub(context, id);
  }

  return readDevice(context, id);
}

/**
 * Tries a configuration against the world, keeping nothing.
 *
 * For a device being edited, a secret left blank in the form is filled from what the row has
 * sealed - the hub opens it - so testing a changed address does not mean typing the password
 * again. The driver's constants and the vendor's saved settings are added the way they would
 * be when the instance starts, so what is tried is what would run.
 *
 * @param context - The request's collaborators.
 * @param body - Which driver, what to try, and which device the blanks come from.
 * @returns The hub's verdict and its sentence.
 * @throws {NotFoundError} When the kind is not loaded, or the named device does not exist.
 * @throws {ValidationError} When the configuration is not what the driver asks.
 */
export async function probeDevice(
  context: DevicesContext,
  body: DeviceProbeRequest,
): Promise<DeviceProbeReply> {
  const { vendor, driver } = await kindOf(context, body.kind);
  const typed = validateSetup(
    driver.setup,
    { transportConfig: body.transportConfig, options: {} },
    body.deviceId === undefined ? 'complete' : 'partial',
  );
  const kept = body.deviceId === undefined ? {} : await storedSecrets(context, body.deviceId);

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
 * The sealed values one device's row holds, to stand in for the blanks of a probe.
 *
 * Only the sealed ones: everything else the form has and sends, and a plain value from the row
 * would override what was just typed.
 *
 * @param context - The request's collaborators.
 * @param id - Which device.
 * @returns Its sealed transport values, by key.
 * @throws {NotFoundError} When no device has that id.
 */
async function storedSecrets(context: DevicesContext, id: string): Promise<JsonObject> {
  const [row] = await context.db
    .select({ transportConfig: schema.registry.integrations.transportConfig })
    .from(schema.registry.integrations)
    .where(eq(schema.registry.integrations.id, id))
    .limit(1);

  if (row === undefined) {
    throw new NotFoundError('No device has that id', { details: { id } });
  }

  return Object.fromEntries(
    Object.entries(asObject(row.transportConfig)).filter(([, value]) => isSealed(value)),
  );
}
