/**
 * Which containers are the platform's, and which compose project a container belongs to.
 *
 * The platform is more than the container it runs in: its compose file starts PostgreSQL and NATS
 * beside it in development, and a user's own compose file may put more there. Every
 * one of them is a **system** container - listed and measured, never stopped, updated or removed
 * from here, and no device - because the page asking would lose what it stands on.
 *
 * Two clues say so, either enough: the label the platform's compose file puts on each of its
 * services, which holds even where the platform does not run in a container at all (development),
 * and sharing a compose project with the platform's own container, which holds for a compose file
 * the owner wrote themselves.
 *
 * `docker compose` labels every container it makes with its project, service and replica, and
 * with where the project's files were: the containers page groups by the first and shows the rest.
 */
import { PLATFORM_LABEL, type ContainerCompose } from '@nebulahome/contracts';

/** The labels `docker compose` puts on every container it makes. */
export const COMPOSE_LABELS = {
  project: 'com.docker.compose.project',
  service: 'com.docker.compose.service',
  number: 'com.docker.compose.container-number',
  workingDir: 'com.docker.compose.project.working_dir',
  configFiles: 'com.docker.compose.project.config_files',
  version: 'com.docker.compose.version',
} as const;

/** What deciding needs about a container: its id and its labels. */
export type LabelledContainer = {
  readonly id: string;
  readonly labels: Readonly<Record<string, string>>;
};

/**
 * The compose project a container belongs to, from its labels.
 *
 * @param labels - The container's labels.
 * @param isEditable - Whether the platform deployed a project by that name, and keeps its file.
 * @returns The project, or null for a container started on its own.
 */
export function composeOf(
  labels: Readonly<Record<string, string>>,
  isEditable: (project: string) => boolean,
): ContainerCompose | null {
  const project = labels[COMPOSE_LABELS.project];
  const service = labels[COMPOSE_LABELS.service];

  if (project === undefined || project === '' || service === undefined || service === '') {
    return null;
  }

  const number = Number(labels[COMPOSE_LABELS.number]);
  const configFiles = labels[COMPOSE_LABELS.configFiles];

  return {
    project: project.slice(0, 128),
    service: service.slice(0, 128),
    number: Number.isInteger(number) && number >= 1 ? number : null,
    workingDir: labels[COMPOSE_LABELS.workingDir]?.slice(0, 1024) ?? null,
    configFiles:
      configFiles === undefined || configFiles === ''
        ? []
        : configFiles
            .split(',')
            .map((file) => file.trim().slice(0, 1024))
            .filter((file) => file !== '')
            .slice(0, 16),
    version: labels[COMPOSE_LABELS.version]?.slice(0, 64) ?? null,
    isEditable: isEditable(project),
  };
}

/**
 * Whether a container is one of the platform's.
 *
 * @param container - The container.
 * @param self - The platform's own container, or null when the platform is not in one.
 * @returns True for the platform's container, one its compose file labels, and one of the same
 * compose project.
 */
export function isSystemContainer(
  container: LabelledContainer,
  self: LabelledContainer | null,
): boolean {
  if (self !== null && container.id === self.id) {
    return true;
  }

  if (container.labels[PLATFORM_LABEL] === 'true') {
    return true;
  }

  const project = container.labels[COMPOSE_LABELS.project];

  return (
    self !== null &&
    project !== undefined &&
    project !== '' &&
    project === self.labels[COMPOSE_LABELS.project]
  );
}
