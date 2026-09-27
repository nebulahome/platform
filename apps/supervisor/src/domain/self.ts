/**
 * Which container the platform itself runs in.
 *
 * Docker mounts a few files into every container from its own folder for that container -
 * `/etc/hostname`, `/etc/hosts`, `/etc/resolv.conf` - and the folder is named after the
 * container's id, so the id can be read out of `/proc/self/mountinfo` whatever the container's
 * host name was set to. On cgroup v1 the id is also in `/proc/self/cgroup`. The host name, which
 * Docker sets to the short id unless told otherwise, is the last resort.
 */

/** A container id in a path Docker mounts from. */
const ID_IN_PATH = /\/containers\/([0-9a-f]{64})\//;

/** A container id in a cgroup path. */
const ID_IN_CGROUP = /(?:docker[-/]|\/)([0-9a-f]{64})(?:\.scope)?$/m;

/**
 * Reads the container's id out of the mount table.
 *
 * @param mountinfo - What `/proc/self/mountinfo` holds.
 * @returns The id, or null outside a container or where the table does not say.
 */
export function containerIdFromMountinfo(mountinfo: string): string | null {
  for (const line of mountinfo.split('\n')) {
    // Only the files Docker writes for the container: a volume could be named anything.
    if (!/ \/etc\/(?:hostname|hosts|resolv\.conf) /.test(line)) {
      continue;
    }

    const match = ID_IN_PATH.exec(line);

    if (match?.[1] !== undefined) {
      return match[1];
    }
  }

  return null;
}

/**
 * Reads the container's id out of the cgroup file, where cgroup v1 names it.
 *
 * @param cgroup - What `/proc/self/cgroup` holds.
 * @returns The id, or null.
 */
export function containerIdFromCgroup(cgroup: string): string | null {
  return ID_IN_CGROUP.exec(cgroup)?.[1] ?? null;
}

/**
 * Finds which of the host's containers is the platform, by the clues it could read.
 *
 * @param ids - Every container's id.
 * @param clues - The id read from the kernel, and the host name.
 * @param clues.fromKernel - The id `/proc` gave, if any.
 * @param clues.hostname - The host name, which Docker sets to the short id by default.
 * @returns The id, or null when none matches: the platform is not in a container.
 */
export function findSelf(
  ids: readonly string[],
  clues: { readonly fromKernel: string | null; readonly hostname: string },
): string | null {
  if (clues.fromKernel !== null && ids.includes(clues.fromKernel)) {
    return clues.fromKernel;
  }

  if (/^[0-9a-f]{12,64}$/.test(clues.hostname)) {
    return ids.find((id) => id.startsWith(clues.hostname)) ?? null;
  }

  return null;
}
