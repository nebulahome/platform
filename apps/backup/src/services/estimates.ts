/**
 * How large each part of a backup will be, before one is taken.
 *
 * What is on disk now is the start: the database's parts, table by table without indexes, and the
 * folders byte for byte. A database dump is compressed and carries no index, so it is a fraction
 * of what the tables take; the folders go in as they are. Once a backup has been taken, its own
 * measured parts are the better guide, scaled by how much has grown since. Either way it is an
 * estimate, and the interface says so.
 */
import path from 'node:path';

import type { BackupEstimates } from '@nebula-home/contracts';

import { FILE_SECTIONS } from '../archive/archive.js';
import { connectAdmin, databasePartSizes } from '../database/admin.js';
import { directorySize } from '../persistence/directory-size.js';

/** How much of what the tables take a compressed dump comes to, before a backup has measured it. */
const DUMP_RATIO = 0.35;

/** How long an estimate is reused before the disk is counted again. */
const CACHE_MS = 10 * 60 * 1000;

/** What the parts take on disk now. */
export type OnDisk = {
  readonly database: { readonly configuration: number; readonly history: number };
  readonly files: { readonly configuration: number; readonly packages: number };
};

/**
 * Counts what the parts take on disk.
 *
 * @param adminUrl - The superuser's URL.
 * @param dataDir - The data directory.
 * @returns The bytes of each part.
 */
export async function measureOnDisk(adminUrl: string, dataDir: string): Promise<OnDisk> {
  const sql = connectAdmin(adminUrl);

  try {
    const database = await databasePartSizes(sql);
    const files = { configuration: 0, packages: 0 };

    for (const folder of FILE_SECTIONS) {
      // eslint-disable-next-line no-await-in-loop -- three folders, one walk at a time.
      const bytes = await directorySize(path.join(dataDir, folder.path));

      if (folder.section === 'packages') {
        files.packages += bytes;
      } else {
        files.configuration += bytes;
      }
    }

    return { database, files };
  } finally {
    await sql.end({ timeout: 5 });
  }
}

/**
 * How large the parts of an archive are, from what is on disk.
 *
 * @param onDisk - What the parts take on disk.
 * @param last - The last backup's measured parts, and what was on disk then, when there is one.
 * @param now - When.
 * @returns The estimates.
 */
export function estimateSections(
  onDisk: OnDisk,
  last: { readonly sectionBytes: Readonly<Record<string, number>>; readonly onDisk: OnDisk } | null,
  now: Date,
): BackupEstimates {
  const fresh = {
    configuration: onDisk.database.configuration * DUMP_RATIO + onDisk.files.configuration,
    history: onDisk.database.history * DUMP_RATIO,
    packages: onDisk.files.packages,
  };

  if (last === null) {
    return { ...roundAll(fresh), basis: 'disk', measuredAt: now };
  }

  const then = {
    configuration:
      last.onDisk.database.configuration * DUMP_RATIO + last.onDisk.files.configuration,
    history: last.onDisk.database.history * DUMP_RATIO,
    packages: last.onDisk.files.packages,
  };
  /**
   * One part, scaled from what the last backup measured by how much it has grown.
   *
   * @param part - The part.
   * @returns The estimate.
   */
  const scaled = (part: 'configuration' | 'history' | 'packages'): number => {
    const measured = last.sectionBytes[part];

    return measured === undefined || measured === 0 || then[part] === 0
      ? fresh[part]
      : measured * (fresh[part] / then[part]);
  };

  return {
    ...roundAll({
      configuration: scaled('configuration'),
      history: scaled('history'),
      packages: scaled('packages'),
    }),
    basis: 'last-backup',
    measuredAt: now,
  };
}

/**
 * Rounds each figure to a whole byte.
 *
 * @param parts - The figures.
 * @param parts.configuration - The configuration's.
 * @param parts.history - The history's.
 * @param parts.packages - The packages'.
 * @returns The same, rounded.
 */
function roundAll(parts: {
  readonly configuration: number;
  readonly history: number;
  readonly packages: number;
}): { configuration: number; history: number; packages: number } {
  return {
    configuration: Math.round(parts.configuration),
    history: Math.round(parts.history),
    packages: Math.round(parts.packages),
  };
}

/** Estimates, counted at most every ten minutes. */
export class EstimateCache {
  #value: { readonly at: number; readonly onDisk: OnDisk } | null = null;

  /**
   * What is on disk, counted again when the last count is older than ten minutes.
   *
   * @param count - Counts it.
   * @param now - The clock, in milliseconds.
   * @returns What is on disk.
   */
  public async onDisk(count: () => Promise<OnDisk>, now: number): Promise<OnDisk> {
    if (this.#value !== null && now - this.#value.at < CACHE_MS) {
      return this.#value.onDisk;
    }

    const onDisk = await count();

    this.#value = { at: now, onDisk };

    return onDisk;
  }

  /** Forgets the last count: a backup just changed what is there. */
  public invalidate(): void {
    this.#value = null;
  }
}
