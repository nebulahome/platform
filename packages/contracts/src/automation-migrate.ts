/**
 * Reads automations written in an older shape of the format as the current one.
 *
 * Run by the document schema before it checks anything, so the engine, the API and the editor
 * all see the current shape whatever is in the column. It only ever rewrites what it recognises
 * as old and passes everything else through untouched, which makes it safe to run on a document
 * that is already current - it gives the same document back.
 *
 * What changed, oldest first:
 * - `{ triggers, conditions, actions }` became `{ triggers, if, then }`.
 * - Triggers and `if` were AND/OR trees (`{ op, items }`, NOT as `{ op: 'not', item }`); now the
 *   triggers are a flat list, any of which wakes the automation, and `if` is a list of
 *   conditions, all of which must hold, with AND/OR groups and NOT on any block. An old AND of
 *   triggers becomes OR: pre-release, and the editor never offered it to anyone.
 * - `state` and `numeric_state` triggers, and `state` and `numeric` conditions, became `entity`.
 * - The `solar` time of a time trigger became a `sun` trigger.
 * - `time_window` and `day_of_week` conditions became `time`.
 * - The `condition` of an If, a loop or a wait became `conditions`.
 * - Parallel `actions` (each a branch, a `sequence` for more than one) became `branches`.
 *
 * `area_occupancy` was removed and is deliberately not rewritten: the schema refuses it, the
 * engine leaves that automation alone and the editor asks for the check to be removed. Dropping
 * it quietly would make the automation run more often than its author meant.
 */

/** An object as stored: anything, keyed by strings. */
type Raw = Record<string, unknown>;

/**
 * Whether a value is a plain object.
 *
 * @param value - Anything.
 * @returns True for an object that is not an array.
 */
function isRaw(value: unknown): value is Raw {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Copies an object without some keys.
 *
 * @param raw - The object.
 * @param keys - What to leave out.
 * @returns The copy.
 */
function without(raw: Raw, ...keys: readonly string[]): Raw {
  return Object.fromEntries(Object.entries(raw).filter(([key]) => !keys.includes(key)));
}

/**
 * Keeps only the keys that are present.
 *
 * @param raw - Keys and values, some undefined.
 * @returns The same without the undefined ones.
 */
function present(raw: Raw): Raw {
  return Object.fromEntries(Object.entries(raw).filter(([, value]) => value !== undefined));
}

/** The keys every block may carry beside what it does. */
const META_KEYS = ['name', 'isEnabled', 'isNot'] as const;

/**
 * The meta of a block, to carry onto what it becomes.
 *
 * @param raw - The old block.
 * @returns Its name, its off switch and its NOT, where it has them.
 */
function metaOf(raw: Raw): Raw {
  return present(Object.fromEntries(META_KEYS.map((key) => [key, raw[key]])));
}

/**
 * Rewrites one old trigger leaf.
 *
 * @param raw - A trigger.
 * @returns The current shape.
 */
export function migrateTrigger(raw: unknown): unknown {
  if (!isRaw(raw)) {
    return raw;
  }

  if (raw['type'] === 'state') {
    return present({
      type: 'entity',
      ...metaOf(raw),
      entityId: raw['entityId'],
      change: present({ kind: 'state', from: raw['from'], to: raw['to'] }),
      forMs: raw['forMs'],
    });
  }

  if (raw['type'] === 'numeric_state') {
    return present({
      type: 'entity',
      ...metaOf(raw),
      entityId: raw['entityId'],
      change: { kind: 'numeric', operator: raw['operator'], value: raw['value'] },
      forMs: raw['forMs'],
    });
  }

  const at = raw['at'];

  if (raw['type'] === 'time' && isRaw(at) && at['kind'] === 'solar') {
    const offset = at['offsetMinutes'];

    return present({
      type: 'sun',
      ...metaOf(raw),
      event: at['event'],
      offsetMinutes: typeof offset === 'number' && offset !== 0 ? offset : undefined,
    });
  }

  return raw;
}

/**
 * Flattens what was stored under `triggers`: a list, a tree, or one leaf.
 *
 * @param raw - The stored triggers.
 * @returns A list of current-shape triggers, or the input when it is nothing of the sort.
 */
export function migrateTriggers(raw: unknown): unknown {
  /**
   * The leaves under one node, left to right.
   *
   * @param node - A leaf or an AND/OR node.
   * @returns The leaves.
   */
  const leaves = (node: unknown): unknown[] =>
    isRaw(node) && (node['op'] === 'and' || node['op'] === 'or') && Array.isArray(node['items'])
      ? node['items'].flatMap(leaves)
      : [migrateTrigger(node)];

  if (Array.isArray(raw)) {
    return raw.flatMap(leaves);
  }

  return isRaw(raw) ? leaves(raw) : raw;
}

/**
 * Turns a condition around, or back.
 *
 * @param raw - A condition in the current shape.
 * @returns The same with its NOT flipped.
 */
function flipped(raw: unknown): unknown {
  if (!isRaw(raw)) {
    return raw;
  }

  return raw['isNot'] === true ? without(raw, 'isNot') : { ...raw, isNot: true };
}

/**
 * Rewrites one condition node, and everything under it.
 *
 * @param raw - A leaf, a group, or an old tree node.
 * @returns The current shape.
 */
export function migrateCondition(raw: unknown): unknown {
  if (!isRaw(raw)) {
    return raw;
  }

  const op = raw['op'];
  const type = raw['type'];

  if (op === 'not') {
    return flipped(migrateCondition(raw['item']));
  }

  if (type === 'not') {
    return flipped(migrateCondition(raw['condition']));
  }

  if ((op === 'and' || op === 'or') && Array.isArray(raw['items'])) {
    return { type: op, ...metaOf(raw), conditions: raw['items'].map(migrateCondition) };
  }

  if ((type === 'and' || type === 'or') && Array.isArray(raw['conditions'])) {
    return { ...raw, conditions: raw['conditions'].map(migrateCondition) };
  }

  switch (type) {
    case 'state': {
      return {
        type: 'entity',
        ...metaOf(raw),
        entityId: raw['entityId'],
        match: { kind: 'state', states: [raw['state']] },
      };
    }
    case 'numeric': {
      return {
        type: 'entity',
        ...metaOf(raw),
        entityId: raw['entityId'],
        match: { kind: 'numeric', operator: raw['operator'], value: raw['value'] },
      };
    }
    case 'time_window': {
      return { type: 'time', ...metaOf(raw), from: raw['from'], to: raw['to'] };
    }
    case 'day_of_week': {
      return { type: 'time', ...metaOf(raw), days: raw['days'] };
    }
    default: {
      return raw;
    }
  }
}

/**
 * Rewrites what was stored as a list of conditions: a list, an old tree, or one leaf.
 *
 * A tree whose root is a plain AND becomes the list of its items, which is what the list means.
 *
 * @param raw - The stored conditions.
 * @returns A list in the current shape, or the input when it is nothing of the sort.
 */
export function migrateConditions(raw: unknown): unknown {
  if (Array.isArray(raw)) {
    return raw.map(migrateCondition);
  }

  if (!isRaw(raw)) {
    return raw;
  }

  const isPlainAnd =
    (raw['op'] === 'and' && Array.isArray(raw['items'])) ||
    (raw['type'] === 'and' &&
      Array.isArray(raw['conditions']) &&
      Object.keys(metaOf(raw)).length === 0);

  if (isPlainAnd) {
    const items = raw['op'] === 'and' ? raw['items'] : raw['conditions'];

    return (items as unknown[]).map(migrateCondition);
  }

  return [migrateCondition(raw)];
}

/**
 * Rewrites a list of actions, and everything under each.
 *
 * @param raw - The stored actions.
 * @returns The current shape, or the input when it is not a list.
 */
export function migrateActions(raw: unknown): unknown {
  return Array.isArray(raw) ? raw.map(migrateAction) : raw;
}

/**
 * Rewrites one action, and everything under it.
 *
 * @param raw - An action.
 * @returns The current shape.
 */
export function migrateAction(raw: unknown): unknown {
  if (!isRaw(raw)) {
    return raw;
  }

  let action: Raw = { ...raw };

  if ('condition' in action && !('conditions' in action)) {
    action = { ...without(action, 'condition'), conditions: migrateConditions(raw['condition']) };
  } else if ('conditions' in action) {
    action['conditions'] = migrateConditions(action['conditions']);
  }

  if (action['type'] === 'parallel' && 'actions' in action && !('branches' in action)) {
    const branches = Array.isArray(raw['actions'])
      ? raw['actions'].map((branch: unknown) =>
          isRaw(branch) && branch['type'] === 'sequence' && Object.keys(metaOf(branch)).length === 0
            ? migrateActions(branch['actions'])
            : [migrateAction(branch)],
        )
      : raw['actions'];

    action = { ...without(action, 'actions'), branches };
  } else if (Array.isArray(action['branches'])) {
    action['branches'] = action['branches'].map(migrateActions);
  }

  for (const key of ['then', 'else', 'actions', 'default'] as const) {
    if (key in action) {
      action[key] = migrateActions(action[key]);
    }
  }

  if (Array.isArray(action['cases'])) {
    action['cases'] = action['cases'].map((branch: unknown) =>
      isRaw(branch) ? { ...branch, actions: migrateActions(branch['actions']) } : branch,
    );
  }

  if ('trigger' in action) {
    action['trigger'] = migrateTrigger(action['trigger']);
  }

  return action;
}

/**
 * Lifts any stored document into `{ triggers, if, then }` in the current shape.
 *
 * @param raw - Whatever was stored in the column.
 * @returns The document shape the schema expects; a current document comes back unchanged.
 */
export function migrateDefinition(raw: unknown): unknown {
  if (!isRaw(raw)) {
    return raw;
  }

  const hasLegacyActions = 'actions' in raw && !('then' in raw);
  const hasLegacyConditions = 'conditions' in raw && !('if' in raw);
  const conditions = 'if' in raw ? raw['if'] : hasLegacyConditions ? raw['conditions'] : undefined;
  const migrated: Raw = {
    triggers: migrateTriggers(raw['triggers']),
    then: migrateActions(hasLegacyActions ? raw['actions'] : raw['then']),
  };

  if (conditions !== undefined && conditions !== null) {
    migrated['if'] = migrateConditions(conditions);
  }

  return migrated;
}
