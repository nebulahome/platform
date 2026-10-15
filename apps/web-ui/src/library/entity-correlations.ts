/**
 * What else in the house names an entity: the automations that watch or command it, the scenes
 * that set it, the aliases worked out from it.
 *
 * Read from the lists the library pages already fetch, not asked of the server: the automations,
 * scenes and aliases of a house are a few dozen documents, and walking them here costs less than
 * a query that would have to understand an automation's nested document to answer the same thing.
 */
import {
  automationDefinitionSchema,
  entityIdsOfDefinition,
  type AutomationDefinition,
  type AliasView,
  type AutomationView,
  type SceneView,
} from '@nebulahome/contracts';

/** Where in an automation an entity is named. */
export type AutomationRole = 'trigger' | 'condition' | 'action';

/** An automation that names the entity, and where. */
export type AutomationCorrelation = {
  readonly id: string;
  readonly name: string;
  readonly isEnabled: boolean;

  /** Where it is named, in the order the document reads: when, if, then. */
  readonly roles: readonly AutomationRole[];
};

/** A scene that sets the entity. */
export type SceneCorrelation = {
  readonly id: string;
  readonly name: string;
};

/** An alias worked out from the entity, or the alias the entity is. */
export type AliasCorrelation = {
  readonly id: string;
  readonly name: string;

  /** `source` when the alias reads the entity; `self` when the entity is the alias. */
  readonly role: 'source' | 'self';
};

/** Everything that names one entity. */
export type EntityCorrelations = {
  readonly automations: readonly AutomationCorrelation[];
  readonly scenes: readonly SceneCorrelation[];
  readonly aliases: readonly AliasCorrelation[];
};

/** A trigger that names no entity, for walking the parts of a document one at a time. */
const NO_TRIGGER = [{ type: 'manual' }] as const;

/**
 * Where in a document an entity is named.
 *
 * @param definition - The parsed document.
 * @param entityId - The entity.
 * @returns The parts that name it, in the order they read.
 */
function rolesIn(definition: AutomationDefinition, entityId: string): AutomationRole[] {
  const parts: readonly (readonly [AutomationRole, AutomationDefinition])[] = [
    ['trigger', { triggers: definition.triggers, then: [] }],
    ['condition', { triggers: NO_TRIGGER, if: definition.if, then: [] }],
    ['action', { triggers: NO_TRIGGER, then: definition.then }],
  ];

  return parts
    .filter(([, part]) => entityIdsOfDefinition(part).includes(entityId))
    .map(([role]) => role);
}

/**
 * Finds everything that names one entity.
 *
 * An automation whose document cannot be read - saved by an older interface in a shape nobody
 * migrated - is left out rather than guessed at.
 *
 * @param entityId - The entity, by its address.
 * @param lists - What the house holds; a list the person may not read is simply empty.
 * @param lists.automations - Every automation.
 * @param lists.scenes - Every scene.
 * @param lists.aliases - Every alias.
 * @returns What names it, each list in the order its own page sorts by: the name.
 */
export function correlationsOf(
  entityId: string,
  lists: {
    readonly automations: readonly AutomationView[];
    readonly scenes: readonly SceneView[];
    readonly aliases: readonly AliasView[];
  },
): EntityCorrelations {
  /**
   * Orders two things by their names.
   *
   * @param a - One.
   * @param b - The other.
   * @returns Their order.
   */
  const byName = <T extends { readonly name: string }>(a: T, b: T): number =>
    a.name.localeCompare(b.name);

  const automations = lists.automations.flatMap((automation) => {
    const parsed = automationDefinitionSchema.safeParse(automation.definition);

    if (!parsed.success) {
      return [];
    }

    const roles = rolesIn(parsed.data, entityId);

    return roles.length === 0
      ? []
      : [{ id: automation.id, name: automation.name, isEnabled: automation.isEnabled, roles }];
  });

  const scenes = lists.scenes
    .filter((scene) => scene.members.some((member) => member.entityId === entityId))
    .map((scene) => ({ id: scene.id, name: scene.name }));

  const aliases = lists.aliases.flatMap((alias): AliasCorrelation[] => {
    if (alias.entityId === entityId) {
      return [{ id: alias.id, name: alias.name, role: 'self' }];
    }

    return alias.sources.some((source) => source.entityId === entityId)
      ? [{ id: alias.id, name: alias.name, role: 'source' }]
      : [];
  });

  return {
    automations: automations.sort(byName),
    scenes: scenes.sort(byName),
    aliases: aliases.sort(byName),
  };
}
