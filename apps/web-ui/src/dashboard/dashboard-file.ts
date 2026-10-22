/**
 * Reading a dashboard file a person chose, before anything is sent.
 *
 * The server checks the file again, but a file that is not JSON, or is JSON of something else, or
 * comes from a newer platform, is better refused here in words the person can act on - and a file
 * that reads is shown before it is imported: its name, how many cards, and how many of them name
 * entities or scenes this house does not have.
 */
import { dashboardDocumentSchema, type DashboardDocument } from '@nebulahome/contracts';

import { allCards } from '@/dashboard/dashboard-layout';
import { translate } from '@/i18n/messages';
import { saveJsonFile } from '@/library/library-file';

/** What reading a file produced. */
export type DashboardFileReading =
  | { readonly ok: true; readonly document: DashboardDocument }
  | { readonly ok: false; readonly problem: string };

/** What a file will bring in, for the preview. */
export type DashboardFileSummary = {
  /** How many cards, the ones inside containers counted. */
  readonly cards: number;

  /** How many cards name an entity this house has no entity for. */
  readonly missingEntities: number;

  /** How many cards name a scene this house has no scene for. */
  readonly missingScenes: number;
};

/**
 * Reads the text of a chosen file as a dashboard.
 *
 * @param text - What the file holds.
 * @returns The dashboard, or why it is not one.
 */
export function readDashboardFile(text: string): DashboardFileReading {
  let parsed: unknown;

  try {
    parsed = JSON.parse(text);
  } catch {
    return {
      ok: false,
      problem: translate(
        'dashboard.dashboardFile.thisFileIsNot',
        'This file is not JSON, so it cannot be a dashboard.',
      ),
    };
  }

  const format =
    typeof parsed === 'object' && parsed !== null && 'format' in parsed ? parsed.format : undefined;

  if (format !== 'nebula-home/dashboard') {
    return {
      ok: false,
      problem: translate(
        'dashboard.dashboardFile.thisFileIsNot2',
        'This file is not a Nebula Home dashboard.',
      ),
    };
  }

  const result = dashboardDocumentSchema.safeParse(parsed);

  if (!result.success) {
    const first = result.error.issues[0];

    return {
      ok: false,
      problem:
        first === undefined
          ? translate(
              'dashboard.dashboardFile.thisDashboardFileDoes',
              'This dashboard file does not read.',
            )
          : translate(
              'dashboard.dashboardFile.thisDashboardFileDoes2',
              'This dashboard file does not read: {{message}}.',
              { message: first.message },
            ),
    };
  }

  return { ok: true, document: result.data };
}

/**
 * Counts what a file brings in, and what of it this house cannot show.
 *
 * @param document - The dashboard in the file.
 * @param hasEntity - Whether this house has an entity at an address.
 * @param hasScene - Whether this house has a scene with an id.
 * @returns The counts.
 */
export function summariseDashboardFile(
  document: DashboardDocument,
  hasEntity: (entityId: string) => boolean,
  hasScene: (sceneId: string) => boolean,
): DashboardFileSummary {
  const cards = allCards(document.layout);

  return {
    cards: cards.length,
    missingEntities: cards.reduce((sum, card) => {
      if (card.type === 'entity') {
        return sum + (hasEntity(card.entityId) ? 0 : 1);
      }

      if (card.type === 'energy') {
        // Every meter an energy card names counts, as a card of its own would.
        return (
          sum +
          [card.solarPower, card.batteryPower, card.batteryLevel, card.gridPower, card.homePower]
            .filter((entityId): entityId is NonNullable<typeof entityId> => entityId !== null)
            .filter((entityId) => !hasEntity(entityId)).length
        );
      }

      return sum;
    }, 0),
    missingScenes: cards.filter((card) => card.type === 'scene' && !hasScene(card.sceneId)).length,
  };
}

/**
 * Hands the person a dashboard file to save.
 *
 * @param file - What the file holds.
 * @param fileName - What it is called.
 */
export function saveDashboardFile(file: DashboardDocument, fileName: string): void {
  saveJsonFile(file, fileName);
}
