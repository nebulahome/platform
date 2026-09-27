/**
 * What an archive is called, and what its name says.
 *
 * `nebulahome-20260927T031500Z-1a2b3c4d.nhbk`: when it was made, in UTC and without the colons a
 * Windows share refuses, and the first eight characters of its run's id, so two runs in the same
 * second never collide. The name is how a location's archives are found and ordered - never by
 * the file's own date, which an FTP server may not keep - and anything not named like this is
 * never listed, and never removed.
 */

/** An archive's name. */
const ARCHIVE_NAME =
  /^nebulahome-(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z-([0-9a-f]{8})\.nhbk$/u;

/** The extension every archive has. */
export const ARCHIVE_EXTENSION = '.nhbk';

/**
 * Names the archive of a run.
 *
 * @param runId - The run's id.
 * @param createdAt - When the run made it.
 * @returns The file name.
 */
export function archiveNameFor(runId: string, createdAt: Date): string {
  const stamp = createdAt
    .toISOString()
    .replace(/\.\d{3}Z$/u, 'Z')
    .replaceAll('-', '')
    .replaceAll(':', '');

  return `nebulahome-${stamp}-${runId.replaceAll('-', '').slice(0, 8)}${ARCHIVE_EXTENSION}`;
}

/**
 * Reads what an archive's name says.
 *
 * @param name - A file name.
 * @returns When the archive was made, or null for a file that is not an archive.
 */
export function parseArchiveName(name: string): { readonly createdAt: Date } | null {
  const match = ARCHIVE_NAME.exec(name);

  if (match === null) {
    return null;
  }

  const [, year = '', month = '', day = '', hours = '', minutes = '', seconds = ''] = match;
  const createdAt = new Date(`${year}-${month}-${day}T${hours}:${minutes}:${seconds}Z`);

  return Number.isNaN(createdAt.getTime()) ? null : { createdAt };
}

/**
 * The name an archive is written under until it is whole: hidden, and not an archive's name, so
 * a half-written file is never listed, pruned or restored.
 *
 * @param name - The archive's name.
 * @returns The temporary name.
 */
export function partialNameOf(name: string): string {
  return `.${name}.partial`;
}
