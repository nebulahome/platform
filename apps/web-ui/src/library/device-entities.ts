/**
 * What the devices list and a device's page both work out from the registry: which entities a
 * device owns, and what its vendor is called.
 */
import type { DeviceView, EntityView } from '@nebulahome/contracts';

/**
 * The entities, by the device that owns them.
 *
 * Grouped by the entity's source, which is the device id - the one a device is listed and
 * linked under - rather than by the registry's row uuid. A package's entities name the package
 * as their source (what its pages filter "its own" by), so a package's device takes the ones it
 * lists.
 *
 * @param entities - Every entity.
 * @param devices - The devices, for the packages' ones.
 * @returns A map from device id to its entities.
 */
export function bySource(
  entities: readonly EntityView[],
  devices: readonly Pick<DeviceView, 'id' | 'origin' | 'entityIds'>[] = [],
): Map<string, EntityView[]> {
  const groups = new Map<string, EntityView[]>();
  const byId = new Map(entities.map((entity) => [entity.entityId, entity]));

  for (const entity of entities) {
    groups.set(entity.source, [...(groups.get(entity.source) ?? []), entity]);
  }

  for (const device of devices) {
    if (device.origin === 'package') {
      groups.set(
        device.id,
        device.entityIds.flatMap((id) => byId.get(id) ?? []),
      );
    }
  }

  return groups;
}

/**
 * The vendors' names by id, with the platform's own for the system device, whose vendor no hub
 * catalogue lists.
 *
 * @param vendors - The vendors the hub has loaded.
 * @returns A map from vendor id to name.
 */
export function vendorNamesOf(
  vendors: readonly { readonly id: string; readonly name: string }[],
): Map<string, string> {
  return new Map([
    ['nebula', 'NebulaHome'],
    ...vendors.map((vendor): [string, string] => [vendor.id, vendor.name]),
  ]);
}
