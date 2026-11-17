/**
 * What removing some devices would do, said before it is done: the devices that go - each one
 * asked for, and the parts that go with their parent - what stops working until pointed
 * elsewhere, and the aliases that read one of the entities, which block the removal.
 *
 * A list, not one device: a removal also comes from places that take several at once - a Matter
 * node, an account signed out of, a vendor uninstalled - and the owner is told about all of them
 * in one place.
 */
import { eq, inArray } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

import {
  NotFoundError,
  parseEntityId,
  type DeviceRemoval,
  type DeviceView,
} from '@nebulahome/contracts';
import { schema } from '@nebulahome/db';

import { entityUsersOf } from './aliases.js';
import { listDevices, type DevicesContext } from './devices.js';

/** One device a removal takes. */
type Target = {
  readonly id: string;
  readonly name: string;
  readonly model: string | null;
  readonly entityIds: readonly string[];

  /** The device it is part of, as listed; null for one part of nothing. */
  readonly parentId: string | null;
};

/**
 * The devices a removal takes: each one asked for, whole with every way into it, then its parts.
 * An id that is one way into a linked device takes that way alone.
 *
 * @param context - The request's collaborators.
 * @param all - Every device, as listed.
 * @param ids - What the owner asked to remove.
 * @returns The devices, each once.
 * @throws {NotFoundError} When an id is no device's.
 */
async function targetsOf(
  context: DevicesContext,
  all: readonly DeviceView[],
  ids: readonly string[],
): Promise<Map<string, Target>> {
  const targets = new Map<string, Target>();
  /**
   * Counts a device among those that go.
   *
   * @param device - The device.
   */
  const add = (device: DeviceView): void => {
    targets.set(device.id, {
      id: device.id,
      name: device.name,
      model: device.model,
      entityIds: device.entityIds,
      parentId: device.parentId,
    });
  };

  for (const id of ids) {
    const device = all.find(
      (one) => one.id === id || (one.linked?.ways.some((way) => way.deviceId === id) ?? false),
    );

    if (device === undefined) {
      throw new NotFoundError('No device has that id', { details: { id } });
    }

    if (device.id !== id) {
      // eslint-disable-next-line no-await-in-loop -- rare: one way into a linked device
      const owned = await context.db
        .select({ entityId: schema.registry.entities.entityId })
        .from(schema.registry.entities)
        .where(eq(schema.registry.entities.integrationId, id));

      targets.set(id, {
        id,
        name: device.name,
        model: device.model,
        entityIds: owned.map((row) => row.entityId),
        parentId: null,
      });
      continue;
    }

    add(device);

    for (const child of all.filter((one) => device.childIds.includes(one.id))) {
      add(child);
    }
  }

  return targets;
}

/**
 * What removing some devices would do.
 *
 * @param context - The request's collaborators.
 * @param ids - The devices the owner would remove.
 * @returns The devices that go, what stops working, and what blocks it.
 * @throws {NotFoundError} When an id is no device's.
 */
export async function previewRemoval(
  context: DevicesContext,
  ids: readonly string[],
): Promise<DeviceRemoval> {
  const targets = await targetsOf(context, await listDevices(context), ids);
  const deviceNameOf = new Map(
    [...targets.values()].flatMap((target) =>
      target.entityIds.map((entityId) => [entityId, target.name] as const),
    ),
  );
  const entityIds = [...deviceNameOf.keys()];
  const { aliasReads, aliases, entities } = schema.registry;
  const aliasEntity = alias(entities, 'alias_entity');
  const [users, reads] = await Promise.all([
    entityUsersOf(context.db, entityIds),
    entityIds.length === 0
      ? []
      : context.db
          .select({
            id: aliases.id,
            name: aliasEntity.name,
            entityId: aliasReads.entityId,
            entityName: entities.name,
          })
          .from(aliasReads)
          .innerJoin(aliases, eq(aliases.id, aliasReads.aliasId))
          .innerJoin(aliasEntity, eq(aliasEntity.id, aliases.entityId))
          .leftJoin(entities, eq(entities.entityId, aliasReads.entityId))
          .where(inArray(aliasReads.entityId, entityIds)),
  ]);
  const blockers = new Map<string, DeviceRemoval['blockedBy']['aliases'][number]>();

  for (const read of reads) {
    const blocker = blockers.get(read.id) ?? { id: read.id, name: read.name, reads: [] };

    if (!blocker.reads.some((each) => each.entityId === read.entityId)) {
      blocker.reads.push({
        entityId: parseEntityId(read.entityId),
        name: read.entityName ?? read.entityId,
        deviceName: deviceNameOf.get(read.entityId) ?? '',
      });
    }

    blockers.set(read.id, blocker);
  }

  return {
    devices: [...targets.values()].map((target) => ({
      id: target.id,
      name: target.name,
      model: target.model,
      entities: target.entityIds.length,
      // Only a parent that goes too: a part asked for alone is one device among the others.
      parentId: target.parentId !== null && targets.has(target.parentId) ? target.parentId : null,
    })),
    usedBy: {
      automations: users.automations,
      scenes: users.scenes,
      dashboards: users.dashboards,
      aliases: users.commanders,
    },
    blockedBy: { aliases: [...blockers.values()] },
  };
}
