/**
 * Containers as the API lists them, for the tests of the containers pages.
 */
import type { ContainerCompose, ContainerSummary } from '@nebula-home/contracts';

/**
 * A plain running container the owner started, varying what a test reads.
 *
 * @param fields - What differs.
 * @returns The container.
 */
export function containerSummary(fields: Partial<ContainerSummary> = {}): ContainerSummary {
  return {
    id: 'a'.repeat(64),
    name: 'adguard',
    displayName: 'Adguard',
    deviceId: 'container-adguard',
    image: 'adguard/adguardhome:v0.107.60',
    version: 'v0.107.60',
    state: 'running',
    status: 'Up 2 hours',
    health: null,
    createdAt: new Date('2026-09-20T10:00:00Z'),
    startedAt: new Date('2026-09-27T08:00:00Z'),
    isSelf: false,
    isSystem: false,
    managedBy: null,
    compose: null,
    registryUrl: null,
    cpuPercent: 1,
    memoryUsedBytes: 1,
    memoryLimitBytes: 2,
    update: {
      installedVersion: null,
      latestVersion: null,
      isAvailable: false,
      checkedAt: null,
      error: null,
      isInstalling: false,
      progress: null,
    },
    refusal: null,
    ...fields,
  };
}

/**
 * A compose project's labels, as the API reads them.
 *
 * @param project - The project.
 * @param service - The service.
 * @param fields - What differs.
 * @returns The compose facts.
 */
export function composeOf(
  project: string,
  service: string,
  fields: Partial<ContainerCompose> = {},
): ContainerCompose {
  return {
    project,
    service,
    number: 1,
    workingDir: `/srv/${project}`,
    configFiles: [`/srv/${project}/compose.yaml`],
    version: '2.39.1',
    isEditable: false,
    ...fields,
  };
}
