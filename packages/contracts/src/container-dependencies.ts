/**
 * The containers a vendor's devices, or a package, depend on: the grammar of a declaration.
 *
 * Zigbee reaches the platform through zigbee2mqtt, which is not a library but a program with a
 * database of its own; the vendor that speaks it cannot work until that program runs. So a vendor's
 * `manifest.json`, and a package's `nebula.package.json`, may declare containers - an image on a
 * registry, the oldest release it works with, what the container is given - and the platform
 * downloads and runs them. The supervisor does the running (ARCHITECTURE.md 4.10); this file is the
 * grammar both declarations share, and `@nebulahome/package-runtime` the step that fills a
 * vendor's settings in.
 *
 * What a declaration may say is narrow on purpose. It names the path **inside** the container of
 * each volume and never a path of the host: where the data lives is the platform's to choose, in
 * its data directory, so a backup takes it. The only paths of the host are the devices, which
 * come from what the owner typed, and must be under `/dev`.
 *
 * Values are text with `{setup.<key>}` where one of the owner's settings goes, and `{platform.…}`
 * where the platform's go (the broker's address, the time zone), which the supervisor fills in. An
 * entry may carry `when`, the grammar of a setup field's `shownWhen`: it applies only while a
 * choice of the settings holds one of the values.
 */
import { z } from 'zod';

import { SEMVER_PATTERN } from './semver.js';

/**
 * An id a bundle gives one of its containers: `zigbee2mqtt`, `mosquitto`. It names the
 * container and its folder of the data directory, so it is a directory name people read - and
 * never `installed` or `compose`, the folders beside it the owner's own containers keep, nor
 * `packages`, where the packages' compose projects are.
 */
export const DEPENDENCY_ID_PATTERN = /^(?!(?:installed|compose|packages)$)[a-z][a-z0-9-]{1,31}$/;

/** How far a container must have come before one that depends on it starts. */
export const CONTAINER_DEPENDENCY_CONDITIONS = ['started', 'healthy'] as const;

/** How far a container must have come before one that depends on it starts. */
export type ContainerDependencyCondition = (typeof CONTAINER_DEPENDENCY_CONDITIONS)[number];

/** A value that is one setting and nothing else, for a number that comes from the settings. */
export const WHOLE_SETTING_PATTERN = /^\{setup\.([a-zA-Z][a-zA-Z0-9]*)\}$/;

/** A path of the host a device may be: under `/dev`, nothing that climbs out of it. */
export const HOST_DEVICE_PATTERN = /^\/dev\/[A-Za-z0-9._/:+-]+$/;

/** A value that is one setting and nothing else. */
const WHOLE_SETTING = WHOLE_SETTING_PATTERN;

/** A path of the host a device may be. */
const DEVICE_PATH = HOST_DEVICE_PATTERN;

/** An entry that applies only while one of the settings holds one of the values. */
export const containerWhenSchema = z.strictObject({
  key: z.string().min(1).max(64),
  equals: z
    .array(z.union([z.string(), z.boolean()]))
    .min(1)
    .max(16),
});

/** A port: a number, or a number the vendor's settings give. */
const portSchema = z.union([
  z.int().min(1).max(65_535),
  z.string().regex(WHOLE_SETTING, 'Must be a port, or {setup.<key>}'),
]);

/** One container a vendor or a package declares. */
export const containerDependencySchema = z.strictObject({
  /** Names the container and its folder of the data directory: `zigbee2mqtt`. */
  id: z.string().regex(DEPENDENCY_ID_PATTERN, 'Must be a short lower-case id'),

  /** What the interface calls it. */
  name: z.string().min(1).max(128),

  /**
   * The image, without a tag: `koenkk/zigbee2mqtt` on Docker Hub, `ghcr.io/owner/app` elsewhere.
   * The release is the platform's to choose, from `minVersion`.
   */
  image: z
    .string()
    .regex(/^[a-z0-9][a-z0-9._/:-]{0,254}$/)
    .refine((image) => !image.slice(image.lastIndexOf('/') + 1).includes(':'), {
      message: 'Name the image without a tag; minVersion says which releases',
    }),

  /**
   * The oldest release the vendor works with. The newest release of the same major is installed,
   * and the container is only upgraded when it falls below this.
   */
  minVersion: z.string().regex(SEMVER_PATTERN, 'Must be a semantic version'),

  /** What the container keeps, by name and where it sees it; `cache` for what can be made again. */
  volumes: z
    .array(
      z.strictObject({
        name: z.string().regex(/^[a-z][a-z0-9-]{0,31}$/),
        path: z.string().regex(/^\/[^\s]*$/, 'Must be an absolute path in the container'),
        cache: z.boolean().default(false),
      }),
    )
    .max(8)
    .default([]),

  env: z
    .array(
      z.strictObject({
        name: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,127}$/),
        value: z.string().max(4096),
        when: containerWhenSchema.optional(),
      }),
    )
    .max(64)
    .default([]),

  /** Devices of the host the container is given: a serial adapter. */
  devices: z
    .array(
      z.strictObject({
        host: z.string().min(1).max(256),
        container: z.string().regex(DEVICE_PATH),
        when: containerWhenSchema.optional(),
      }),
    )
    .max(8)
    .default([]),

  /** Ports published on the machine, when the platform is on a bridge. */
  ports: z
    .array(
      z.strictObject({
        container: portSchema,
        host: portSchema,
        protocol: z.enum(['tcp', 'udp']).default('tcp'),
        when: containerWhenSchema.optional(),
      }),
    )
    .max(8)
    .default([]),

  /** Files written into a volume once, when missing: a first configuration. */
  seed: z
    .array(
      z.strictObject({
        volume: z.string().min(1).max(32),
        path: z
          .string()
          .regex(/^[a-zA-Z0-9._-][a-zA-Z0-9._/-]{0,254}$/)
          .refine((value) => !value.split('/').includes('..'), 'Must stay inside its volume'),
        content: z.string().max(65_536),
      }),
    )
    .max(8)
    .default([]),

  /**
   * The MQTT topics it publishes and subscribes under, when it speaks to the house's broker:
   * `zigbee2mqtt/#`. The broker gives the container a username of its own, held to them - every
   * topic when not said.
   */
  mqttTopics: z
    .array(z.string().min(1).max(256).regex(/^[^$]/, "Not the broker's own topics"))
    .min(1)
    .max(16)
    .optional(),

  /**
   * The container port its own web page is on, which the interface links to while that port is
   * published. A number, or a number the vendor's settings give.
   */
  webPort: portSchema.optional(),

  /** Whether the web page is published at all: a condition on the settings, like `when`. */
  webPortWhen: containerWhenSchema.optional(),

  /** The command the container runs, in place of its image's: each argument on its own. */
  command: z.array(z.string().max(4096)).min(1).max(64).optional(),

  /**
   * How the platform knows the container is ready, in Docker's words: `test` is `CMD` and its
   * arguments, or `CMD-SHELL` and one line for a shell.
   */
  healthcheck: z
    .strictObject({
      test: z
        .array(z.string().min(1).max(4096))
        .min(2)
        .max(64)
        .refine((test) => test[0] === 'CMD' || test[0] === 'CMD-SHELL', {
          message: 'Starts with CMD or CMD-SHELL',
        }),
      intervalMs: z.int().min(1000).max(3_600_000).optional(),
      timeoutMs: z.int().min(1000).max(600_000).optional(),
      retries: z.int().min(1).max(100).optional(),
      startPeriodMs: z.int().min(0).max(3_600_000).optional(),
    })
    .optional(),

  /**
   * The containers of the same declaration this one starts after, and how far each must have
   * come: `started`, or `healthy` for one with a `healthcheck`.
   */
  dependsOn: z
    .record(
      z.string().regex(DEPENDENCY_ID_PATTERN, 'Must be a container of the same declaration'),
      z.enum(CONTAINER_DEPENDENCY_CONDITIONS),
    )
    .optional(),
});

/** One container a vendor or a package declares. */
export type ContainerDependency = z.output<typeof containerDependencySchema>;

/** The containers a vendor or a package declares, as its manifest holds them. */
export const containerDependenciesSchema = z
  .array(containerDependencySchema)
  .max(4)
  .default([])
  .refine((deps) => new Set(deps.map((dep) => dep.id)).size === deps.length, {
    message: 'Each container needs an id of its own',
  })
  .superRefine((deps, context) => {
    for (const [index, problem] of dependsOnProblems(deps)) {
      context.addIssue({ code: 'custom', path: [index, 'dependsOn'], message: problem });
    }
  });

/**
 * What is wrong with the containers' `dependsOn`: a container that is not declared, itself, one
 * waited for as healthy that has no healthcheck, or a circle.
 *
 * @param deps - The declaration's containers.
 * @returns Each problem, with the index of the container that has it.
 */
function dependsOnProblems(
  deps: readonly z.output<typeof containerDependencySchema>[],
): [number, string][] {
  const byId = new Map(deps.map((dep) => [dep.id, dep]));
  const problems: [number, string][] = [];

  for (const [index, dep] of deps.entries()) {
    for (const [target, condition] of Object.entries(dep.dependsOn ?? {})) {
      const other = byId.get(target);

      if (target === dep.id) {
        problems.push([index, `${dep.id} cannot start after itself`]);
      } else if (other === undefined) {
        problems.push([index, `${target} is not one of the declared containers`]);
      } else if (condition === 'healthy' && other.healthcheck === undefined) {
        problems.push([index, `${target} has no healthcheck to wait for`]);
      }
    }
  }

  /**
   * Says whether a container, by following what it starts after, comes back to where it began.
   *
   * @param id - Where the walk is.
   * @param path - The containers walked through.
   * @returns True on a circle.
   */
  const isCircular = (id: string, path: readonly string[]): boolean =>
    Object.keys(byId.get(id)?.dependsOn ?? {}).some(
      (next) => path.includes(next) || (byId.has(next) && isCircular(next, [...path, next])),
    );

  for (const [index, dep] of deps.entries()) {
    if (isCircular(dep.id, [dep.id]) && !problems.some(([at]) => at === index)) {
      problems.push([index, `${dep.id} starts after a container that starts after it`]);
    }
  }

  return problems;
}
