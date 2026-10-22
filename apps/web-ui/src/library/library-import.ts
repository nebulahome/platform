/**
 * What an imported file names that this house does not have, and pointing it at what it does.
 *
 * An entity is listed once however often the file names it, with what it has to be able to do -
 * the capability a command sends to, the ones a scene member sets - so the person picks from the
 * entities that would work. Pointing is a rename of addresses: the rest of each block stays.
 */
import {
  automationDefinitionSchema,
  forEachBlock,
  renameEntities,
  type AutomationDefinition,
  type CapabilityName,
  type EntityView,
  type JsonObject,
} from '@nebulahome/contracts';

import type { ImportedAutomation, ImportedScene } from '@/library/ha-import';
import { resolveTargetState } from '@/library/scene-target-state';

/** One address an import names that the house does not have. */
export type MissingEntity = {
  readonly entityId: string;

  /** How many blocks or members name it. */
  readonly uses: number;

  /** What it has to be able to do, when the file says. */
  readonly capabilities: readonly CapabilityName[];
};

/** Counts addresses as they are met. */
class Tally {
  readonly #found = new Map<string, { uses: number; capabilities: Set<CapabilityName> }>();

  /**
   * Counts one use.
   *
   * @param entityId - The address.
   * @param capabilities - What this use needs of it.
   */
  public add(entityId: string, capabilities: readonly CapabilityName[] = []): void {
    if (entityId === '') {
      return;
    }

    const entry = this.#found.get(entityId) ?? { uses: 0, capabilities: new Set() };

    entry.uses += 1;

    for (const capability of capabilities) {
      entry.capabilities.add(capability);
    }

    this.#found.set(entityId, entry);
  }

  /**
   * The addresses the house does not have.
   *
   * @param has - Whether the house has an address.
   * @returns Them, in the order first met.
   */
  public missing(has: (entityId: string) => boolean): MissingEntity[] {
    return [...this.#found]
      .filter(([entityId]) => !has(entityId))
      .map(([entityId, entry]) => ({
        entityId,
        uses: entry.uses,
        capabilities: [...entry.capabilities],
      }));
  }
}

/**
 * The entities imported automations name that the house does not have.
 *
 * @param items - The automations.
 * @param has - Whether the house has an address.
 * @returns The missing ones.
 */
export function missingOfAutomations(
  items: readonly Pick<ImportedAutomation, 'definition'>[],
  has: (entityId: string) => boolean,
): MissingEntity[] {
  const tally = new Tally();

  for (const item of items) {
    const parsed = automationDefinitionSchema.safeParse(item.definition);
    // A draft still being written does not parse; its lists are there all the same.
    const definition = parsed.success
      ? parsed.data
      : (item.definition as unknown as AutomationDefinition);

    forEachBlock(definition, (visited) => {
      const block = visited.block;

      if (visited.family === 'action' && visited.block.type === 'command') {
        tally.add(visited.block.entityId, [visited.block.capability as CapabilityName]);
      } else if (
        'entityId' in block &&
        typeof block.entityId === 'string' &&
        block.entityId !== ''
      ) {
        tally.add(block.entityId);
      } else if (visited.family === 'condition' && visited.block.type === 'expression') {
        for (const entityId of Object.values(visited.block.variables ?? {})) {
          tally.add(entityId);
        }
      }
    });
  }

  return tally.missing(has);
}

/**
 * The entities imported scenes set that the house does not have.
 *
 * @param items - The scenes.
 * @param has - Whether the house has an address.
 * @returns The missing ones.
 */
export function missingOfScenes(
  items: readonly Pick<ImportedScene, 'members'>[],
  has: (entityId: string) => boolean,
): MissingEntity[] {
  const tally = new Tally();

  for (const item of items) {
    for (const member of item.members) {
      tally.add(member.entityId, Object.keys(member.targetState) as CapabilityName[]);
    }
  }

  return tally.missing(has);
}

/**
 * Imported automations with the entities somebody pointed elsewhere renamed.
 *
 * @param items - The automations.
 * @param renames - Old address to new.
 * @returns Them, renamed.
 */
export function renameAutomations(
  items: readonly ImportedAutomation[],
  renames: ReadonlyMap<string, string>,
): ImportedAutomation[] {
  return items.map((item) => ({ ...item, definition: renameEntities(item.definition, renames) }));
}

/** A scene ready to save: members on entities that exist, and the ones still waiting. */
export type ResolvedScene = Omit<ImportedScene, 'members'> & {
  readonly members: readonly {
    entityId: string;
    targetState: JsonObject;
    transitionMs: number | null;
  }[];
  readonly unresolvedMembers: readonly {
    entityId: string;
    targetState: JsonObject;
    transitionMs: number | null;
  }[];
};

/**
 * Imported scenes with their members renamed, and split between the ones whose entity the house
 * has - their state narrowed to what that entity takes - and the ones still waiting for one. Two
 * members landing on one entity keep the first.
 *
 * @param items - The scenes.
 * @param renames - Old address to new.
 * @param entityOf - The house's entity at an address.
 * @returns Them, ready to save.
 */
export function resolveScenes(
  items: readonly ImportedScene[],
  renames: ReadonlyMap<string, string>,
  entityOf: (entityId: string) => EntityView | undefined,
): ResolvedScene[] {
  return items.map((item) => {
    const seen = new Set<string>();
    const members: ResolvedScene['members'][number][] = [];
    const unresolvedMembers: ResolvedScene['unresolvedMembers'][number][] = [];

    for (const member of item.members) {
      const entityId = renames.get(member.entityId) ?? member.entityId;
      const entity = entityOf(entityId);

      if (seen.has(entityId)) {
        continue;
      }

      seen.add(entityId);

      if (entity === undefined) {
        unresolvedMembers.push({ ...member, entityId });
      } else {
        members.push({
          entityId,
          targetState: resolveTargetState(member.targetState, entity) as JsonObject,
          transitionMs: member.transitionMs,
        });
      }
    }

    return { ...item, members, unresolvedMembers };
  });
}
