/**
 * The installed vendors' folders, as the packet-manager keeps them: `hub/integrations/<vendor>/`,
 * one folder per build, and the marker beside them that names the build `hub` loads.
 *
 * The marker is written last, once `hub` has loaded its build, and written whole - to a file beside
 * it, then renamed over it - so `hub` reading it at start never finds half of one. A vendor folder
 * with no marker was put there by hand, or is a bundle under development: the packet-manager
 * neither lists it as installed nor removes it.
 */
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { VENDOR_ID_PATTERN } from '@nebulahome/contracts';
import {
  INSTALL_MARKER_FILE,
  installMarkerSchema,
  type InstallMarker,
} from '@nebulahome/package-runtime';

/**
 * A vendor's marker.
 *
 * @param integrationsDir - The data directory's `hub/integrations/`.
 * @param vendorId - The vendor.
 * @returns What it says; undefined when there is none, or it does not hold together.
 */
export async function readMarker(
  integrationsDir: string,
  vendorId: string,
): Promise<InstallMarker | undefined> {
  try {
    const text = await readFile(path.join(integrationsDir, vendorId, INSTALL_MARKER_FILE), 'utf8');
    const parsed = installMarkerSchema.safeParse(JSON.parse(text) as unknown);

    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Every vendor the platform installed, with its marker.
 *
 * @param integrationsDir - The data directory's `hub/integrations/`.
 * @returns The markers, by vendor.
 */
export async function readMarkers(integrationsDir: string): Promise<Map<string, InstallMarker>> {
  let names: string[];

  try {
    names = await readdir(integrationsDir);
  } catch {
    return new Map();
  }

  const read = await Promise.all(
    names
      .filter((name) => VENDOR_ID_PATTERN.test(name))
      .map(async (name) => [name, await readMarker(integrationsDir, name)] as const),
  );

  return new Map(
    read.flatMap(([name, marker]) => (marker === undefined ? [] : [[name, marker] as const])),
  );
}

/**
 * Names a build the current one: writes the vendor's marker whole.
 *
 * @param integrationsDir - The data directory's `hub/integrations/`.
 * @param vendorId - The vendor.
 * @param marker - What it says.
 * @returns Once it is in place.
 */
export async function writeMarker(
  integrationsDir: string,
  vendorId: string,
  marker: InstallMarker,
): Promise<void> {
  const folder = path.join(integrationsDir, vendorId);
  const file = path.join(folder, INSTALL_MARKER_FILE);
  const partial = `${file}.partial`;

  await mkdir(folder, { recursive: true });
  await writeFile(partial, `${JSON.stringify(marker, null, 2)}\n`, 'utf8');
  await rename(partial, file);
}

/**
 * Deletes every build of a vendor but one.
 *
 * @param integrationsDir - The data directory's `hub/integrations/`.
 * @param vendorId - The vendor.
 * @param keep - The build kept: the current one.
 * @returns Once they are gone.
 */
export async function removeOtherBuilds(
  integrationsDir: string,
  vendorId: string,
  keep: string,
): Promise<void> {
  const folder = path.join(integrationsDir, vendorId);
  const entries = await readdir(folder, { withFileTypes: true });

  await Promise.all(
    entries
      .filter((entry) => entry.isDirectory() && entry.name !== keep)
      .map(async (entry) => rm(path.join(folder, entry.name), { recursive: true, force: true })),
  );
}
