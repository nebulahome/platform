/**
 * Every list of blocks in an automation, by the path the editor, the trace and a test name it by.
 *
 * A list is `triggers`, `if` or `then`, or a list inside a block: `then.2.then`, `then.2.else`,
 * `then.3.cases.1`, `then.3.default`, `then.4.actions`, `then.5.branches.0`,
 * `then.6.conditions`, `if.1.conditions`. A block is a list and an index: `then.2.else.0`. The same
 * paths the engine records its steps under (`forEachBlock` in the contracts), so a run's trace
 * and a test point at the very card.
 *
 * Moving a block - by dragging it or with the keyboard - is a pure rewrite of the draft: take it
 * out of one list, put it in another of the same family (an action among actions, a condition
 * among conditions), never into itself. The containers rebuilt on the way keep their ids
 * (`block-ids.ts`), so nothing open closes and nothing selected is lost.
 */
import { carryBlockId } from '@/lib/block-ids';
import type { AutomationDraft } from '@/library/automation-draft';

/** Which part of the document a list belongs to: only blocks of one family move between lists. */
export type BlockFamily = 'trigger' | 'condition' | 'action';

/** A place in a list: where a block is, or where one would land. */
export type BlockSlot = {
  /** The list. */
  readonly list: string;

  /** The place in it: 0 before the first, its length after the last. */
  readonly index: number;
};

/**
 * Whether a path segment is an index.
 *
 * @param segment - The segment.
 * @returns True for digits.
 */
function isIndex(segment: string | undefined): boolean {
  return segment !== undefined && /^\d+$/u.test(segment);
}

/**
 * The segments a path walks through the draft.
 *
 * A switch's case is named `cases.1` - the case is a list of blocks to whoever reads the path -
 * while the draft holds the blocks under the case's `actions`; this puts that step back in.
 *
 * @param path - The path.
 * @returns The segments, as the draft holds them.
 */
function segmentsOf(path: string): string[] {
  const parts = path.split('.');
  const resolved: string[] = [];

  for (const [at, part] of parts.entries()) {
    resolved.push(part);

    if (parts[at - 1] === 'cases' && isIndex(part)) {
      resolved.push('actions');
    }
  }

  return resolved;
}

/**
 * What a path names in a value.
 *
 * @param root - Where the walk starts.
 * @param segments - The steps.
 * @returns The value there, or undefined.
 */
function valueAt(root: unknown, segments: readonly string[]): unknown {
  let node: unknown = root;

  for (const segment of segments) {
    if (Array.isArray(node)) {
      node = node[Number(segment)];
    } else if (node !== null && typeof node === 'object') {
      node = (node as Record<string, unknown>)[segment];
    } else {
      return undefined;
    }
  }

  return node;
}

/**
 * A value with one thing somewhere inside it replaced, every object on the way copied - and
 * keeping its id, so a copied block is the same block.
 *
 * @param node - The value.
 * @param segments - Where the replacement goes.
 * @param replacement - What goes there.
 * @returns The new value.
 */
function withValueAt(node: unknown, segments: readonly string[], replacement: unknown): unknown {
  const [head, ...rest] = segments;

  if (head === undefined) {
    return replacement;
  }

  if (Array.isArray(node)) {
    const index = Number(head);
    const list: readonly unknown[] = node;
    const copy = [...list];
    const child = list[index];
    const updated = withValueAt(child, rest, replacement);

    copy[index] =
      child !== null && typeof child === 'object' && updated !== null && typeof updated === 'object'
        ? carryBlockId(child, updated)
        : updated;

    return copy;
  }

  const record = (node ?? {}) as Record<string, unknown>;

  return carryBlockId(record, { ...record, [head]: withValueAt(record[head], rest, replacement) });
}

/**
 * The list a path names.
 *
 * @param draft - The draft.
 * @param path - The list.
 * @returns Its blocks, or undefined when the path names no list - an else not added yet.
 */
export function getList(draft: AutomationDraft, path: string): readonly unknown[] | undefined {
  const value = valueAt(draft, segmentsOf(path));

  return Array.isArray(value) ? value : undefined;
}

/**
 * The draft with one list replaced.
 *
 * @param draft - The draft.
 * @param path - The list.
 * @param items - Its blocks as they now are.
 * @returns The new draft.
 */
export function setList(
  draft: AutomationDraft,
  path: string,
  items: readonly unknown[],
): AutomationDraft {
  return withValueAt(draft, segmentsOf(path), items) as AutomationDraft;
}

/**
 * The block a path names.
 *
 * @param draft - The draft.
 * @param path - The block: a list and an index.
 * @returns The block, or undefined.
 */
export function getBlock(draft: AutomationDraft, path: string): object | undefined {
  const value = valueAt(draft, segmentsOf(path));

  return value !== null && typeof value === 'object' ? value : undefined;
}

/**
 * Which family a list holds.
 *
 * @param path - The list.
 * @returns Trigger for the triggers, condition for any list of conditions, action otherwise.
 */
export function familyOfList(path: string): BlockFamily {
  if (path === 'triggers') {
    return 'trigger';
  }

  return path === 'if' || path.endsWith('.conditions') ? 'condition' : 'action';
}

/**
 * The paths of the blocks a list sits inside, outermost first: what must be open for it to show.
 *
 * @param path - The list.
 * @returns The blocks' paths.
 */
export function containersOf(path: string): string[] {
  const parts = path.split('.');

  return parts.flatMap((part, at) =>
    isIndex(part) && at + 1 < parts.length && !isIndex(parts[at + 1])
      ? [parts.slice(0, at + 1).join('.')]
      : [],
  );
}

/**
 * Whether one list lies inside a block - the block itself, or anything it holds.
 *
 * @param list - The list.
 * @param blockPath - The block.
 * @returns True when the list is the block's or a list within it.
 */
export function isInside(list: string, blockPath: string): boolean {
  return list === blockPath || list.startsWith(`${blockPath}.`);
}

/**
 * The lists a block holds, with their paths, in the order they read.
 *
 * @param block - The block.
 * @param path - Its path.
 * @returns Each list and its path.
 */
function listsInside(block: unknown, path: string): (readonly [string, readonly unknown[]])[] {
  if (block === null || typeof block !== 'object') {
    return [];
  }

  const node = block as Partial<Record<string, unknown>> & { readonly type?: unknown };
  const lists: (readonly [string, readonly unknown[]])[] = [];

  /**
   * Adds a list when the block has one under that name.
   *
   * @param key - The field.
   * @param listPath - Its path.
   */
  const add = (key: string, listPath = `${path}.${key}`): void => {
    const value = node[key];

    if (Array.isArray(value)) {
      lists.push([listPath, value]);
    }
  };

  switch (node.type) {
    case 'and':
    case 'or':
    case 'wait_for': {
      add('conditions');
      break;
    }
    case 'if': {
      add('conditions');
      add('then');
      add('else');
      break;
    }
    case 'while':
    case 'do_while': {
      add('conditions');
      add('actions');
      break;
    }
    case 'for':
    case 'sequence': {
      add('actions');
      break;
    }
    case 'switch': {
      const cases = Array.isArray(node['cases']) ? (node['cases'] as unknown[]) : [];

      for (const [index, branch] of cases.entries()) {
        const actions = (branch as { readonly actions?: unknown } | null)?.actions;

        if (Array.isArray(actions)) {
          lists.push([`${path}.cases.${String(index)}`, actions]);
        }
      }

      lists.push([`${path}.default`, Array.isArray(node['default']) ? node['default'] : []]);
      break;
    }
    case 'parallel': {
      const branches = Array.isArray(node['branches']) ? (node['branches'] as unknown[]) : [];

      for (const [index, branch] of branches.entries()) {
        if (Array.isArray(branch)) {
          lists.push([`${path}.branches.${String(index)}`, branch]);
        }
      }

      break;
    }
    default: {
      break;
    }
  }

  return lists;
}

/**
 * Every place a block of one family could go, in reading order: before each block of each list
 * of that family, after the last, and through the lists every block holds.
 *
 * @param draft - The draft.
 * @param family - The family.
 * @returns The places.
 */
export function dropSlots(draft: AutomationDraft, family: BlockFamily): BlockSlot[] {
  const slots: BlockSlot[] = [];

  /**
   * Adds the places of one list and of everything inside its blocks.
   *
   * @param items - The list.
   * @param path - Its path.
   */
  const walk = (items: readonly unknown[], path: string): void => {
    const isOwn = familyOfList(path) === family;

    for (const [index, item] of items.entries()) {
      if (isOwn) {
        slots.push({ list: path, index });
      }

      for (const [listPath, list] of listsInside(item, `${path}.${String(index)}`)) {
        walk(list, listPath);
      }
    }

    if (isOwn) {
      slots.push({ list: path, index: items.length });
    }
  };

  walk(draft.triggers, 'triggers');
  walk(draft.if, 'if');
  walk(draft.then, 'then');

  return slots;
}

/**
 * Moves a block from one place to another.
 *
 * @param draft - The draft.
 * @param from - Where the block is.
 * @param to - Where it should land, counted in the list as it is now.
 * @returns The new draft, or null when the move is not one: another family, into itself, nowhere.
 */
export function moveBlock(
  draft: AutomationDraft,
  from: BlockSlot,
  to: BlockSlot,
): AutomationDraft | null {
  const blockPath = `${from.list}.${String(from.index)}`;
  const source = getList(draft, from.list);
  const block = source?.[from.index];

  if (
    source === undefined ||
    block === undefined ||
    familyOfList(from.list) !== familyOfList(to.list) ||
    isInside(to.list, blockPath)
  ) {
    return null;
  }

  let target = to;

  if (to.list === from.list) {
    const index = to.index > from.index ? to.index - 1 : to.index;

    if (index === from.index) {
      return null;
    }

    target = { list: to.list, index };
  } else if (to.list.startsWith(`${from.list}.`)) {
    // The target is inside a later block of the same list, which moves up one when the block
    // leaves.
    const fromDepth = from.list.split('.').length;
    const parts = to.list.split('.');
    const at = Number(parts[fromDepth]);

    if (at > from.index) {
      parts[fromDepth] = String(at - 1);
    }

    target = { list: parts.join('.'), index: to.index };
  }

  const removed = setList(draft, from.list, [
    ...source.slice(0, from.index),
    ...source.slice(from.index + 1),
  ]);
  const destination = getList(removed, target.list) ?? [];
  const index = Math.max(0, Math.min(target.index, destination.length));

  return setList(removed, target.list, [
    ...destination.slice(0, index),
    block,
    ...destination.slice(index),
  ]);
}

/**
 * Moves a block one place up or down in reading order, walking into and out of the lists other
 * blocks hold - as the keyboard moves a block.
 *
 * @param draft - The draft.
 * @param from - Where the block is.
 * @param step - Up (-1) or down (+1).
 * @returns The new draft and where the block now is, or null at either end.
 */
export function stepBlock(
  draft: AutomationDraft,
  from: BlockSlot,
  step: -1 | 1,
): { readonly draft: AutomationDraft; readonly at: BlockSlot } | null {
  const source = getList(draft, from.list);
  const block = source?.[from.index];

  if (source === undefined || block === undefined) {
    return null;
  }

  const removed = setList(draft, from.list, [
    ...source.slice(0, from.index),
    ...source.slice(from.index + 1),
  ]);
  const slots = dropSlots(removed, familyOfList(from.list));
  const here = slots.findIndex((slot) => slot.list === from.list && slot.index === from.index);
  const target = slots[here + step];

  if (here === -1 || target === undefined) {
    return null;
  }

  const destination = getList(removed, target.list) ?? [];

  return {
    draft: setList(removed, target.list, [
      ...destination.slice(0, target.index),
      block,
      ...destination.slice(target.index),
    ]),
    at: target,
  };
}
