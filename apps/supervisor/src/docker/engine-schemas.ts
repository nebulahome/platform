/**
 * What Docker's API answers, as far as the supervisor reads it.
 *
 * Every schema is loose: Docker adds fields with every release and the supervisor reads a few of
 * them, so an unknown field is kept rather than refused - the inspect answer of a container is
 * handed back to Docker whole when the container is recreated, and must not lose anything on the
 * way. What is read is still validated, because a daemon that answers something unexpected must
 * fail here, naming the field, rather than as `undefined` three calls later.
 */
import { z } from 'zod';

/** A map of strings, which Docker sends as `null` when it is empty. */
const stringMapSchema = z
  .record(z.string(), z.string())
  .nullish()
  .transform((value) => value ?? {});

/** A list of strings, which Docker sends as `null` when it is empty. */
const stringListSchema = z
  .array(z.string())
  .nullish()
  .transform((value) => value ?? []);

/** `GET /version`. */
export const engineVersionSchema = z.looseObject({
  Version: z.string(),
  ApiVersion: z.string(),
  MinAPIVersion: z.string().optional(),
  Os: z.string().optional(),
  Arch: z.string().optional(),
});

/** What the engine says about itself. */
export type EngineVersion = z.output<typeof engineVersionSchema>;

/** `GET /info`, the two fields read. */
export const engineInfoSchema = z.looseObject({
  Name: z.string().optional(),
  NCPU: z.number().optional(),
  MemTotal: z.number().optional(),

  /** `Docker Desktop` on Windows and macOS, the host's distribution elsewhere. */
  OperatingSystem: z.string().optional(),
});

/** What the engine says about the machine. */
export type EngineInfo = z.output<typeof engineInfoSchema>;

/** One port of a listed container. */
const listedPortSchema = z.looseObject({
  IP: z.string().optional(),
  PrivatePort: z.number(),
  PublicPort: z.number().optional(),
  Type: z.string(),
});

/** One entry of `GET /containers/json`. */
export const listedContainerSchema = z.looseObject({
  Id: z.string(),
  Names: stringListSchema,
  Image: z.string(),
  ImageID: z.string().optional(),
  Created: z.number(),
  State: z.string(),
  Status: z.string().default(''),
  Ports: z
    .array(listedPortSchema)
    .nullish()
    .transform((value) => value ?? []),
  Labels: stringMapSchema,
});

/** One container as the list gives it. */
export type ListedContainer = z.output<typeof listedContainerSchema>;

/** `GET /containers/json`. */
export const containerListSchema = z.array(listedContainerSchema);

/** One network a container is attached to, in its inspect answer. */
const endpointSchema = z.looseObject({
  IPAddress: z.string().optional(),
  Gateway: z.string().optional(),
  NetworkID: z.string().optional(),
  Aliases: stringListSchema,
});

/** One mount, in a container's inspect answer. */
const inspectMountSchema = z.looseObject({
  Type: z.string(),
  Name: z.string().optional(),
  Source: z.string().optional(),
  Destination: z.string(),
  RW: z.boolean().optional(),
});

/** A container's configuration: what it was created with. */
export const containerConfigSchema = z.looseObject({
  Hostname: z.string().optional(),
  Env: stringListSchema,
  Cmd: stringListSchema,
  Entrypoint: z
    .union([z.array(z.string()), z.string()])
    .nullish()
    .transform((value) => (value === null || value === undefined ? [] : [value].flat())),
  Image: z.string(),
  Labels: stringMapSchema,
  WorkingDir: z.string().optional(),
  User: z.string().optional(),

  /** Whether it has a terminal, which is whether its logs come multiplexed or raw. */
  Tty: z.boolean().optional(),
});

/** A container's configuration. */
export type ContainerConfig = z.output<typeof containerConfigSchema>;

/** The host's side of a container: how it is attached to the machine. */
export const hostConfigSchema = z.looseObject({
  NetworkMode: z.string().optional(),
  RestartPolicy: z.looseObject({ Name: z.string().optional() }).nullish(),
  Devices: z
    .array(z.looseObject({ PathOnHost: z.string(), PathInContainer: z.string() }))
    .nullish()
    .transform((value) => value ?? []),
  Memory: z.number().optional(),
});

/** `GET /containers/{id}/json`. */
export const inspectedContainerSchema = z.looseObject({
  Id: z.string(),
  Name: z.string(),
  Created: z.string(),
  Image: z.string(),
  State: z.looseObject({
    Status: z.string(),
    Running: z.boolean().optional(),
    StartedAt: z.string().optional(),
    Health: z.looseObject({ Status: z.string() }).nullish(),
  }),
  Config: containerConfigSchema,
  HostConfig: hostConfigSchema,
  Mounts: z
    .array(inspectMountSchema)
    .nullish()
    .transform((value) => value ?? []),
  NetworkSettings: z.looseObject({
    Networks: z
      .record(z.string(), endpointSchema)
      .nullish()
      .transform((value) => value ?? {}),
    Ports: z
      .record(
        z.string(),
        z
          .array(z.looseObject({ HostIp: z.string().optional(), HostPort: z.string().optional() }))
          .nullable(),
      )
      .nullish()
      .transform((value) => value ?? {}),
  }),
});

/** One container, inspected. */
export type InspectedContainer = z.output<typeof inspectedContainerSchema>;

/** `GET /images/{name}/json`. */
export const inspectedImageSchema = z.looseObject({
  Id: z.string(),
  RepoTags: stringListSchema,
  RepoDigests: stringListSchema,
  Config: z
    .looseObject({
      Env: stringListSchema,
      Cmd: stringListSchema,
      Entrypoint: z
        .union([z.array(z.string()), z.string()])
        .nullish()
        .transform((value) => (value === null || value === undefined ? [] : [value].flat())),
      Labels: stringMapSchema,
      WorkingDir: z.string().optional(),
      User: z.string().optional(),
    })
    .nullish(),
});

/** One image, inspected. */
export type InspectedImage = z.output<typeof inspectedImageSchema>;

/** `GET /containers/{id}/stats?stream=false&one-shot=true`, the fields read. */
export const containerStatsSchema = z.looseObject({
  cpu_stats: z.looseObject({
    cpu_usage: z.looseObject({ total_usage: z.number() }),
    system_cpu_usage: z.number().optional(),
    online_cpus: z.number().optional(),
  }),
  memory_stats: z.looseObject({
    usage: z.number().optional(),
    limit: z.number().optional(),
    stats: z.record(z.string(), z.number()).optional(),
  }),
});

/** One reading of a container's counters. */
export type ContainerStats = z.output<typeof containerStatsSchema>;

/** `GET /networks/{id}`, the fields read. */
export const inspectedNetworkSchema = z.looseObject({
  Id: z.string(),
  Name: z.string(),
  Containers: z
    .record(z.string(), z.looseObject({}))
    .nullish()
    .transform((value) => value ?? {}),
});

/** One network, inspected. */
export type InspectedNetwork = z.output<typeof inspectedNetworkSchema>;

/** `POST /containers/create`. */
export const createdContainerSchema = z.looseObject({
  Id: z.string(),
  Warnings: stringListSchema,
});

/** `GET /volumes/{name}`. */
export const inspectedVolumeSchema = z.looseObject({
  Name: z.string(),
  Driver: z.string(),
  Labels: stringMapSchema,

  /** The driver's options: a `local` volume with any is kept somewhere else - NFS, CIFS. */
  Options: stringMapSchema,
});

/** One volume, inspected. */
export type InspectedVolume = z.output<typeof inspectedVolumeSchema>;

/** `POST /containers/{id}/wait`. */
export const waitedContainerSchema = z.looseObject({ StatusCode: z.number() });

/** One line of `GET /events`. */
export const engineEventSchema = z.looseObject({
  Type: z.string(),
  Action: z.string(),
  Actor: z.looseObject({
    ID: z.string(),
    Attributes: stringMapSchema,
  }),
});

/** Something that happened to a container. */
export type EngineEvent = z.output<typeof engineEventSchema>;

/** One line of a pull's progress. */
export const pullProgressSchema = z.looseObject({
  status: z.string().optional(),
  id: z.string().optional(),
  progressDetail: z
    .looseObject({ current: z.number().optional(), total: z.number().optional() })
    .nullish(),
  error: z.string().optional(),
});

/** One line of a pull's progress. */
export type PullProgress = z.output<typeof pullProgressSchema>;

/** What Docker answers a refused call with. */
export const engineErrorSchema = z.looseObject({ message: z.string() });
