/**
 * Entities in the command palette: found by name, id, area, device, aliases and kind; Enter opens
 * the entity's dialog over the page, Tab turns one that switches on or off.
 */
import type { DeviceView, EntityView, TagView } from '@nebulahome/contracts';

import { entityScopesOf, hasCapability, isCommandable } from '@/library/entity-control';
import { entityKindOf } from '@/library/entity-kind';
import type { PaletteItem } from '@/palette/palette-types';
import { goTo, makeItem } from '@/palette/sources/make-item';
import { entityPath } from '@/routes/library/entity/entity-path';

/** What the entities' rows are built from. */
export type EntitySource = {
  readonly entities: readonly EntityView[];

  /** For the device's name, and its tags in the control scopes; empty without `device:read`. */
  readonly devices: readonly DeviceView[];

  /** For the control scopes; empty without `tag:read`. */
  readonly tags: readonly TagView[];
  readonly can: (key: string, scopes?: readonly string[]) => boolean;
};

/**
 * The entities' rows. Hidden and disabled entities are left out: they were hidden on purpose.
 *
 * @param source - See {@link EntitySource}.
 * @returns The rows.
 */
export function entityItems(source: EntitySource): PaletteItem[] {
  const { entities, devices, tags, can } = source;
  // An entity carries its device's id as its source; a package's or a virtual device's lists them.
  const bySource = new Map(devices.map((device) => [device.id, device]));
  const byEntity = new Map(
    devices.flatMap((device) => device.entityIds.map((entityId) => [entityId, device] as const)),
  );

  return entities
    .filter((entity) => !entity.isHidden && entity.isEnabled)
    .map((entity) => {
      const device = bySource.get(entity.source) ?? byEntity.get(entity.entityId);
      const kind = entityKindOf(entity);
      const canPower =
        hasCapability(entity, 'on_off') &&
        isCommandable(entity) &&
        can('entity:control', entityScopesOf(entity, tags, device?.tagIds ?? []));

      return makeItem({
        group: 'entities',
        refId: entity.entityId,
        title: entity.name,
        secondary: [device?.name, entity.areaName].filter(Boolean).join(' · '),
        fields: [entity.entityId, kind.label, ...entity.searchAliases],
        exactIds: [entity.entityId],
        icon: { kind: 'catalogue', iconId: entity.icon, fallback: kind.icon },
        isName: true,
        entity,
        primary: goTo(entityPath(entity.entityId)),
        // The hint is the live state's to say: Turn on, or Turn off.
        ...(canPower ? { secondaryAction: { hint: '', command: { type: 'power', entity } } } : {}),
      });
    });
}
