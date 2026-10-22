/**
 * Automations and scenes as files: what Export hands over, and what Import reads back - this
 * platform's own files, or Home Assistant's YAML, ported by `ha-import.ts`.
 *
 * A file of either kind holds a list, so one automation and forty go through the same code. Read
 * here, before anything is sent, so a file that is not one, or comes from a newer platform, is
 * refused in words; what reads is then checked against this house (entities it does not have) by
 * the import flow, and saved through the same create the editor uses.
 */
import { parse } from 'yaml';
import { z } from 'zod';

import {
  AUTOMATION_MODES,
  automationDefinitionSchema,
  entityIdSchema,
  jsonObjectSchema,
  libraryKeySchema,
  type AutomationView,
  type SceneView,
} from '@nebulahome/contracts';

import { translate } from '@/i18n/messages';
import {
  convertHaAutomations,
  convertHaScenes,
  uniqueKey,
  type ImportedAutomation,
  type ImportedScene,
  type ImportNote,
} from '@/library/ha-import';

/** This platform's automations file. */
export const AUTOMATIONS_FORMAT = 'nebula-home/automations';

/** This platform's scenes file. */
export const SCENES_FORMAT = 'nebula-home/scenes';

/** The version of both files this build writes, and the newest it reads. */
const FILE_VERSION = 1;

/** One automation in a file. */
const fileAutomationSchema = z.object({
  key: libraryKeySchema,
  name: z.string().trim().min(1).max(120),
  description: z.string().max(2000).default(''),
  mode: z.enum(AUTOMATION_MODES).default('single'),
  maxRuntimeMs: z.int().min(1000).max(86_400_000).default(300_000),
  isEnabled: z.boolean().default(true),
  definition: jsonObjectSchema,
});

/** One scene in a file. */
const fileSceneSchema = z.object({
  key: libraryKeySchema,
  name: z.string().trim().min(1).max(120),
  icon: z.string().nullable().default(null),
  areaKey: z.string().nullable().default(null),
  transitionMs: z.int().min(0).max(600_000).default(0),
  rollbackOnPartialFailure: z.boolean().default(false),
  members: z
    .array(
      z.object({
        entityId: entityIdSchema,
        targetState: jsonObjectSchema,
        transitionMs: z.int().min(0).max(600_000).nullable().default(null),
      }),
    )
    .max(200),
});

/** What a file brought in. */
export type LibraryImport =
  | {
      readonly kind: 'automations';
      readonly source: 'nebula' | 'home-assistant';
      readonly items: readonly ImportedAutomation[];
      readonly notes: readonly ImportNote[];
      readonly hints: Readonly<Record<string, string>>;
    }
  | {
      readonly kind: 'scenes';
      readonly source: 'nebula' | 'home-assistant';
      readonly items: readonly ImportedScene[];
      readonly notes: readonly ImportNote[];
      readonly hints: Readonly<Record<string, string>>;
    };

/** What reading a file produced. */
export type LibraryFileReading =
  | { readonly ok: true; readonly file: LibraryImport }
  | { readonly ok: false; readonly problem: string };

/**
 * A refusal in words.
 *
 * @param problem - Why.
 * @returns The reading.
 */
function refused(problem: string): LibraryFileReading {
  return { ok: false, problem };
}

/**
 * Whether a value is a record.
 *
 * @param value - Anything.
 * @returns True for a plain object.
 */
function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Reads one of this platform's files, item by item: an item that does not read is left out and
 * said so, rather than the whole file refused for it.
 *
 * @param document - The parsed file.
 * @param kind - Which it is.
 * @param taken - Keys already used here; a file's key that is taken gets a suffix.
 * @returns What it brought in.
 */
function readOwnFile(
  document: Readonly<Record<string, unknown>>,
  kind: 'automations' | 'scenes',
  taken: Set<string>,
): LibraryFileReading {
  if (typeof document['version'] !== 'number' || document['version'] > FILE_VERSION) {
    return refused(
      translate(
        'libraryFile.newerVersion',
        'This file comes from a newer Nebula Home. Update this one to import it.',
      ),
    );
  }

  const list = Array.isArray(document[kind]) ? (document[kind] as unknown[]) : [];
  const notes: ImportNote[] = [];

  if (kind === 'automations') {
    const items = list.flatMap((entry, index): ImportedAutomation[] => {
      const parsed = fileAutomationSchema.safeParse(entry);
      const definition = parsed.success
        ? automationDefinitionSchema.safeParse(parsed.data.definition)
        : null;

      if (!parsed.success || definition?.success !== true) {
        const issue = (parsed.success ? definition?.error : parsed.error)?.issues[0];

        notes.push({
          item:
            isRecord(entry) && typeof entry['name'] === 'string'
              ? entry['name']
              : `#${String(index + 1)}`,
          message: translate(
            'libraryFile.itemUnread',
            'It does not read and was left out: {{why}}',
            {
              why: issue === undefined ? '?' : `${issue.path.join('.')} ${issue.message}`,
            },
          ),
        });

        return [];
      }

      return [{ ...parsed.data, key: uniqueKey(parsed.data.key, taken, 'automation') }];
    });

    return { ok: true, file: { kind, source: 'nebula', items, notes, hints: {} } };
  }

  const items = list.flatMap((entry, index): ImportedScene[] => {
    const parsed = fileSceneSchema.safeParse(entry);

    if (!parsed.success) {
      const issue = parsed.error.issues[0];

      notes.push({
        item:
          isRecord(entry) && typeof entry['name'] === 'string'
            ? entry['name']
            : `#${String(index + 1)}`,
        message: translate('libraryFile.itemUnread', 'It does not read and was left out: {{why}}', {
          why: issue === undefined ? '?' : `${issue.path.join('.')} ${issue.message}`,
        }),
      });

      return [];
    }

    return [{ ...parsed.data, key: uniqueKey(parsed.data.key, taken, 'scene') }];
  });

  return { ok: true, file: { kind, source: 'nebula', items, notes, hints: {} } };
}

/**
 * Reads the text of a chosen file as automations or scenes.
 *
 * Tried as this platform's own file first, then as Home Assistant's: `automations.yaml` and
 * `scenes.yaml` (lists), one automation or scene, or a `configuration.yaml` with `automation:`
 * and `scene:` sections. YAML reads JSON too, so one parser takes both.
 *
 * @param text - What the file holds.
 * @param taken - Keys already used here, by kind: an imported key that is taken gets a suffix.
 * @param taken.automations - The automations' keys.
 * @param taken.scenes - The scenes' keys.
 * @returns What it brought in, or why it is not something to import.
 */
export function readLibraryFile(
  text: string,
  taken: { readonly automations: Iterable<string>; readonly scenes: Iterable<string> },
): LibraryFileReading {
  let document: unknown;

  try {
    // Home Assistant's own tags (!secret, !include) are kept as plain strings, not refused.
    document = parse(text, { logLevel: 'silent', uniqueKeys: false });
  } catch {
    return refused(
      translate(
        'libraryFile.notReadable',
        'This file is neither JSON nor YAML, so it holds no automations or scenes.',
      ),
    );
  }

  const automationKeys = new Set(taken.automations);
  const sceneKeys = new Set(taken.scenes);

  if (isRecord(document) && document['format'] === AUTOMATIONS_FORMAT) {
    return readOwnFile(document, 'automations', automationKeys);
  }

  if (isRecord(document) && document['format'] === SCENES_FORMAT) {
    return readOwnFile(document, 'scenes', sceneKeys);
  }

  if (isRecord(document) && typeof document['format'] === 'string') {
    return refused(
      translate(
        'libraryFile.otherFormat',
        'This file is a {{format}}, not automations or scenes.',
        {
          format: document['format'],
        },
      ),
    );
  }

  const automations =
    isRecord(document) && 'automation' in document ? document['automation'] : null;
  const scenes = isRecord(document) && 'scene' in document ? document['scene'] : null;
  const list = Array.isArray(document) ? document : isRecord(document) ? [document] : [];
  /**
   * Whether an entry reads as a Home Assistant scene.
   *
   * @param entry - One entry of the file.
   * @returns True when it has entities to set.
   */
  const looksLikeScene = (entry: unknown): boolean =>
    isRecord(entry) && isRecord(entry['entities']);
  /**
   * Whether an entry reads as a Home Assistant automation.
   *
   * @param entry - One entry of the file.
   * @returns True when it has triggers, actions or a blueprint.
   */
  const looksLikeAutomation = (entry: unknown): boolean =>
    isRecord(entry) &&
    ['trigger', 'triggers', 'action', 'actions', 'use_blueprint'].some((key) => key in entry);

  if (automations !== null && automations !== undefined) {
    const converted = convertHaAutomations(
      Array.isArray(automations) ? automations : [automations],
      automationKeys,
    );

    return { ok: true, file: { kind: 'automations', source: 'home-assistant', ...converted } };
  }

  if (scenes !== null && scenes !== undefined) {
    const converted = convertHaScenes(Array.isArray(scenes) ? scenes : [scenes], sceneKeys);

    return { ok: true, file: { kind: 'scenes', source: 'home-assistant', ...converted } };
  }

  if (list.length > 0 && list.some(looksLikeAutomation)) {
    const converted = convertHaAutomations(list.filter(looksLikeAutomation), automationKeys);

    return { ok: true, file: { kind: 'automations', source: 'home-assistant', ...converted } };
  }

  if (list.length > 0 && list.some(looksLikeScene)) {
    const converted = convertHaScenes(list.filter(looksLikeScene), sceneKeys);

    return { ok: true, file: { kind: 'scenes', source: 'home-assistant', ...converted } };
  }

  return refused(
    translate(
      'libraryFile.nothingToImport',
      'Nothing in this file reads as an automation or a scene.',
    ),
  );
}

/**
 * Automations as this platform's file.
 *
 * @param automations - What to put in it.
 * @returns The file.
 */
export function automationsFile(
  automations: readonly Pick<
    AutomationView,
    'key' | 'name' | 'description' | 'mode' | 'maxRuntimeMs' | 'isEnabled' | 'definition'
  >[],
): Record<string, unknown> {
  return {
    format: AUTOMATIONS_FORMAT,
    version: FILE_VERSION,
    automations: automations.map((automation) => ({
      key: automation.key,
      name: automation.name,
      description: automation.description,
      mode: automation.mode,
      maxRuntimeMs: automation.maxRuntimeMs,
      isEnabled: automation.isEnabled,
      definition: automation.definition,
    })),
  };
}

/**
 * Scenes as this platform's file. Members still waiting for an entity go in as members: whoever
 * imports the file points them at entities of their own.
 *
 * @param scenes - What to put in it.
 * @returns The file.
 */
export function scenesFile(scenes: readonly SceneView[]): Record<string, unknown> {
  return {
    format: SCENES_FORMAT,
    version: FILE_VERSION,
    scenes: scenes.map((scene) => ({
      key: scene.key,
      name: scene.name,
      icon: scene.icon,
      areaKey: scene.areaKey,
      transitionMs: scene.transitionMs,
      rollbackOnPartialFailure: scene.rollbackOnPartialFailure,
      members: [
        ...scene.members.map((member) => ({
          entityId: member.entityId,
          targetState: member.targetState,
          transitionMs: member.transitionMs,
        })),
        ...scene.unresolvedMembers,
      ],
    })),
  };
}

/**
 * Hands the person a JSON file to save.
 *
 * @param value - What the file holds.
 * @param fileName - What it is called.
 */
export function saveJsonFile(value: unknown, fileName: string): void {
  const blob = new Blob([`${JSON.stringify(value, null, 2)}\n`], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');

  link.href = url;
  link.download = fileName;
  link.click();

  // The download has started from the link; the address is not needed after this turn.
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 0);
}
