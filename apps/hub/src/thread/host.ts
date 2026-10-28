/**
 * What the Thread broker reads and writes on the server itself: the network interface the
 * border router joins Thread to, the IPv6 settings the house needs to reach Thread devices, the
 * border router's `otbr.conf`, and the version of the `otbr-agent` the image ships.
 *
 * Linux only, and behind {@link ThreadHost}: a test points it at a folder laid out as `/proc`.
 */
import { execFile } from 'node:child_process';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

/** The file the `otbr` service reads, in the border router's folder. */
export const OTBR_CONF = 'otbr.conf';

/** The platform's border router, where the image puts it. */
const AGENT = '/usr/local/sbin/otbr-agent';

/** How long `otbr-agent --version` may take. */
const VERSION_TIMEOUT_MS = 5000;

/** What the `otbr` service is started with: its radio, and the interface it joins Thread to. */
export type OtbrConfig = {
  /** `spinel+hdlc+uart:///dev/serial/by-id/…?uart-baudrate=460800`. */
  readonly radioUrl: string;
  readonly infraIf: string;
};

/** The server, as the Thread broker sees it. */
export type ThreadHost = {
  /** The interface the default route leaves by, IPv6's first; null with no default route. */
  readonly defaultInterface: () => Promise<string | null>;

  /** One setting of an interface under `/proc/sys/net/ipv6/conf`; null when it is not there. */
  readonly ipv6Setting: (iface: string, name: string) => Promise<string | null>;

  /** Writes `otbr.conf` whole. */
  readonly writeConfig: (config: OtbrConfig) => Promise<void>;

  /** Removes `otbr.conf`, so the service idles at its next start. */
  readonly removeConfig: () => Promise<void>;

  /** What the platform's `otbr-agent` says its version is; null where there is none. */
  readonly agentVersion: () => Promise<string | null>;
};

/** Where the host reads and writes. */
export type LinuxThreadHostOptions = {
  /** The border router's folder: `<data>/hub/thread`. */
  readonly configDir: string;

  /** `/proc`, unless a test lays one out. */
  readonly procDir?: string;

  /** The `otbr-agent` binary, unless a test says another. */
  readonly agent?: string;
};

/**
 * A file's text, or null when it cannot be read.
 *
 * @param file - The file.
 * @returns Its text.
 */
async function textOf(file: string): Promise<string | null> {
  try {
    return await readFile(file, 'utf8');
  } catch {
    return null;
  }
}

/**
 * The interface of the default route with the lowest metric in a routing table.
 *
 * @param table - The table's text.
 * @param read - Reads a line's interface and metric when it is a default route.
 * @returns The interface, or null.
 */
function defaultOf(
  table: string | null,
  read: (fields: string[]) => { iface: string; metric: number } | null,
): string | null {
  const routes = (table ?? '')
    .split('\n')
    .map((line) => read(line.trim().split(/\s+/u)))
    .filter((route) => route !== null && route.iface !== 'lo')
    .sort((left, right) => (left?.metric ?? 0) - (right?.metric ?? 0));

  return routes[0]?.iface ?? null;
}

/**
 * The server's own host.
 *
 * @param options - Where it reads and writes.
 * @returns The host.
 */
export function createLinuxThreadHost(options: LinuxThreadHostOptions): ThreadHost {
  const proc = options.procDir ?? '/proc';
  const conf = path.join(options.configDir, OTBR_CONF);

  return {
    /**
     * Reads the default route's interface: IPv6's (`/proc/net/ipv6_route`: destination `::/0`),
     * else IPv4's (`/proc/net/route`: destination and mask `00000000`).
     *
     * @returns The interface, or null.
     */
    defaultInterface: async () => {
      const [ipv6, ipv4] = await Promise.all([
        textOf(path.join(proc, 'net', 'ipv6_route')),
        textOf(path.join(proc, 'net', 'route')),
      ]);

      return (
        defaultOf(ipv6, (fields) =>
          fields.length >= 10 && /^0{32}$/u.test(fields[0] ?? '') && fields[1] === '00'
            ? { iface: fields[9] ?? '', metric: Number.parseInt(fields[5] ?? '0', 16) }
            : null,
        ) ??
        defaultOf(ipv4, (fields) =>
          fields.length >= 8 && fields[1] === '00000000' && fields[7] === '00000000'
            ? { iface: fields[0] ?? '', metric: Number(fields[6] ?? '0') }
            : null,
        )
      );
    },

    /**
     * Reads one IPv6 setting of an interface.
     *
     * @param iface - The interface, or `all`.
     * @param name - The setting: `accept_ra`.
     * @returns Its value, trimmed.
     */
    ipv6Setting: async (iface, name) =>
      (await textOf(path.join(proc, 'sys', 'net', 'ipv6', 'conf', iface, name)))?.trim() ?? null,

    /**
     * Writes the file through a temporary one, so the service never reads half of it.
     *
     * @param config - The radio and the interface.
     * @returns Once written.
     */
    writeConfig: async (config) => {
      await mkdir(options.configDir, { recursive: true });
      await writeFile(`${conf}.tmp`, `RADIO_URL=${config.radioUrl}\nINFRA_IF=${config.infraIf}\n`, {
        mode: 0o644,
      });
      await rename(`${conf}.tmp`, conf);
    },

    /**
     * Removes the file.
     *
     * @returns Once gone.
     */
    removeConfig: async () => {
      await rm(conf, { force: true });
    },

    /**
     * Asks the binary.
     *
     * @returns Its first line, or null when it is not there or did not answer.
     */
    agentVersion: async () =>
      new Promise((resolve) => {
        execFile(
          options.agent ?? AGENT,
          ['--version'],
          { timeout: VERSION_TIMEOUT_MS },
          (error, stdout) => {
            const version = stdout.split('\n')[0]?.trim() ?? '';

            resolve(error === null && version !== '' ? version.slice(0, 128) : null);
          },
        );
      }),
  };
}
