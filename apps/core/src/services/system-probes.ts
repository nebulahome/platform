/**
 * Reading the machine: its processor, its memory, a volume and its network.
 *
 * The only file in `core` that asks the operating system about itself, so the system monitor can
 * be tested with a machine made up on the spot. Everything read here is the host's, including
 * from inside a container: `os.cpus()` and `os.totalmem()` read `/proc/stat` and
 * `/proc/meminfo`, which a container shares with its host. The network is the exception - a
 * container has its own - which is why its path is configurable.
 */
import { execFile as nodeExecFile } from 'node:child_process';
import { readFile, statfs } from 'node:fs/promises';
import os from 'node:os';
import { dirname, join } from 'node:path';

import type { SystemHost } from '@nebulahome/contracts';
import type { PlatformLogger } from '@nebulahome/logging';

import {
  defaultRouteInterface,
  parseNetstatE,
  parseProcNetDev,
  type NetworkCounters,
} from '../domain/network-counters.js';
import { totalCpuTimes, type CpuTotals } from '../domain/system-samples.js';

/** How long `netstat` is given before its answer is not worth waiting for. */
const NETSTAT_TIMEOUT_MS = 5000;

/** Runs a program and hands back what it printed. */
export type RunProgram = (file: string, args: readonly string[]) => Promise<string>;

/** The size of a volume and how much of it is taken. */
export type VolumeReading = {
  readonly totalBytes: number;

  /** What an unprivileged process could still write. */
  readonly freeBytes: number;

  /** What is in use, root's reserve excluded. */
  readonly usedBytes: number;
};

/** Everything the system monitor asks the machine. */
export type SystemProbes = {
  /** The processor time of every core, added together. */
  readonly readCpu: () => CpuTotals;

  /** The memory in use and in total. */
  readonly readMemory: () => { readonly usedBytes: number; readonly totalBytes: number };

  /** The volume a path is on, or undefined when it cannot be read. */
  readonly readVolume: (path: string) => Promise<VolumeReading | undefined>;

  /** The network's byte counters, or undefined where they cannot be read. */
  readonly readNetwork: () => Promise<NetworkCounters | undefined>;

  /** The machine itself. */
  readonly readHost: () => SystemHost;
};

/** How the probes are built. */
export type SystemProbesOptions = {
  /** Where Linux keeps the network counters; `route` is read from beside it. */
  readonly netDevPath: string;

  readonly logger: PlatformLogger;

  /** The platform to read as; the running one by default. */
  readonly platform?: NodeJS.Platform;

  /** How a program is run; `execFile` by default. */
  readonly runProgram?: RunProgram;
};

/**
 * Runs a program with `execFile`, without a window and within a time limit.
 *
 * @param file - The program.
 * @param args - Its arguments.
 * @returns What it printed on standard output.
 */
const runWithExecFile: RunProgram = async (file, args) =>
  new Promise((resolve, reject) => {
    nodeExecFile(
      file,
      [...args],
      { timeout: NETSTAT_TIMEOUT_MS, windowsHide: true, encoding: 'utf8' },
      (error, stdout) => {
        if (error === null) {
          resolve(stdout);
        } else {
          reject(new Error(`${file} failed`, { cause: error }));
        }
      },
    );
  });

/**
 * Names the operating system the way a person would.
 *
 * `os.version()` is the product name on Windows ("Windows 11 Pro") and the kernel's build
 * banner on Linux, which nobody would call its name; the kernel release reads better there.
 *
 * @param platform - Which platform.
 * @returns The name.
 */
function osName(platform: NodeJS.Platform): string {
  return platform === 'win32' ? os.version() : `${os.type()} ${os.release()}`;
}

/**
 * Builds the probes for this machine.
 *
 * @param options - Where the network counters are, the logger, and what to stand in for.
 * @returns The probes.
 */
export function createSystemProbes(options: SystemProbesOptions): SystemProbes {
  const platform = options.platform ?? process.platform;
  const runProgram = options.runProgram ?? runWithExecFile;
  const complained = new Set<string>();

  /**
   * Says once that something cannot be read, rather than every ten seconds.
   *
   * @param what - What could not be read.
   * @param error - Why.
   */
  const complainOnce = (what: string, error: unknown): void => {
    if (!complained.has(what)) {
      complained.add(what);
      options.logger.warn({ err: error, what }, 'The system monitor cannot read part of the host');
    }
  };

  return {
    /**
     * Adds up the time of every core.
     *
     * @returns The busy and total time since boot.
     */
    readCpu: () => totalCpuTimes(os.cpus()),

    /**
     * Reads the memory. `freemem` is what could be handed out without swapping - MemAvailable
     * on Linux - so what is left over is what is genuinely taken, the page cache excluded.
     *
     * @returns The memory in use and in total.
     */
    readMemory: () => {
      const totalBytes = os.totalmem();

      return { totalBytes, usedBytes: Math.max(0, totalBytes - os.freemem()) };
    },

    /**
     * Reads the volume a path is on.
     *
     * @param path - Any path on the volume.
     * @returns Its size and what is taken, or undefined when it cannot be read.
     */
    readVolume: async (path) => {
      try {
        const volume = await statfs(path);

        return {
          totalBytes: volume.blocks * volume.bsize,
          freeBytes: volume.bavail * volume.bsize,
          usedBytes: (volume.blocks - volume.bfree) * volume.bsize,
        };
      } catch (error: unknown) {
        complainOnce('volume', error);

        return undefined;
      }
    },

    /**
     * Reads the network's byte counters: the interface the default route leaves by on Linux,
     * every interface summed on Windows, nothing elsewhere.
     *
     * @returns The counters, or undefined where they cannot be read.
     */
    readNetwork: async () => {
      try {
        if (platform === 'linux') {
          const [devices, routes] = await Promise.all([
            readFile(options.netDevPath, 'utf8'),
            readFile(join(dirname(options.netDevPath), 'route'), 'utf8').catch(() => ''),
          ]);
          const outbound = defaultRouteInterface(routes);

          return parseProcNetDev(devices, outbound) ?? parseProcNetDev(devices, undefined);
        }

        if (platform === 'win32') {
          return parseNetstatE(await runProgram('netstat', ['-e']));
        }

        return undefined;
      } catch (error: unknown) {
        complainOnce('network', error);

        return undefined;
      }
    },

    /**
     * Describes the machine.
     *
     * @returns Its name, its operating system, its processor and how long it has been up.
     */
    readHost: () => {
      const cores = os.cpus();

      return {
        hostname: os.hostname(),
        platform,
        osName: osName(platform),
        arch: os.arch(),
        uptimeSeconds: os.uptime(),
        cpuModel: cores[0]?.model.trim() ?? 'Unknown processor',
        cpuCount: Math.max(1, cores.length),
      };
    },
  };
}
