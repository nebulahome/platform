/**
 * Reading a dashboard file a person chose, before anything is sent.
 *
 * The server checks the file again, but a file that is not JSON, or is JSON of something else, or
 * comes from a newer platform, is better refused here in words the person can act on - and a file
 * that reads is shown before it is imported: its name, how many cards, and how many of them name
 * entities or scenes this house does not have.
 */
import { dashboardDocumentSchema, type DashboardDocument } from '@nebula-home/contracts';

import { allCards } from '@/dashboard/dashboard-layout';

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
    return { ok: false, problem: 'This file is not JSON, so it cannot be a dashboard.' };
  }

  const format =
    typeof parsed === 'object' && parsed !== null && 'format' in parsed ? parsed.format : undefined;

  if (format !== 'nebula-home/dashboard') {
    return { ok: false, problem: 'This file is not a Nebula Home dashboard.' };
  }

  const result = dashboardDocumentSchema.safeParse(parsed);

  if (!result.success) {
    const first = result.error.issues[0];

    return {
      ok: false,
      problem:
        first === undefined
          ? 'This dashboard file does not read.'
          : `This dashboard file does not read: ${first.message}.`,
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
    missingEntities: cards.filter((card) => card.type === 'entity' && !hasEntity(card.entityId))
      .length,
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
  const blob = new Blob([`${JSON.stringify(file, null, 2)}\n`], { type: 'application/json' });
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
