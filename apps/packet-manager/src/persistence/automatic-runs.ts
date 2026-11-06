/**
 * The day each kind last updated by itself (docs/releases-and-updates.md 4), kept in a file of the
 * cache: what tells a packet-manager that starts after a window whether that day's run was
 * missed. A file lost costs one run not made up, nothing more.
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { z } from 'zod';

import type { AutoKind } from './update-settings.js';

/** The day, `YYYY-MM-DD` on its window's clock, each kind last ran by itself. */
export type AutomaticRuns = Partial<Record<AutoKind, string>>;

/** What the file holds. */
const automaticRunsSchema = z.partialRecord(
  z.enum(['package', 'integration']),
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
);

/**
 * Reads the days.
 *
 * @param file - The file.
 * @returns Them; none when the file is missing or unreadable.
 */
export async function readAutomaticRuns(file: string): Promise<AutomaticRuns> {
  try {
    return automaticRunsSchema.parse(JSON.parse(await readFile(file, 'utf8')));
  } catch {
    return {};
  }
}

/**
 * Writes the days, whole or not at all.
 *
 * @param file - The file.
 * @param runs - The days.
 */
export async function writeAutomaticRuns(file: string, runs: AutomaticRuns): Promise<void> {
  const written = `${file}.tmp`;

  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(written, JSON.stringify(runs));
  await rename(written, file);
}
