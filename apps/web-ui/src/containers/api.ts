/**
 * The calls the containers pages make.
 *
 * Every answer is parsed with the contract's schema, as everywhere else, so a server that changes
 * the shape fails the parse instead of drawing a page out of whatever arrived.
 */
import { z } from 'zod';

import {
  composeDocumentSchema,
  composeValidationSchema,
  containerDetailSchema,
  containerLogsReplySchema,
  containersViewSchema,
  containerSummarySchema,
  imageDescriptionSchema,
  imageSearchReplySchema,
  imageTagsReplySchema,
  type ComposeDefinition,
  type ComposeDocument,
  type ComposeValidation,
  type ContainerAction,
  type ContainerDetail,
  type ContainerInstallRequest,
  type ContainerLogsReply,
  type ContainersView,
  type ContainerSummary,
  type ImageDescription,
  type ImageSearchReply,
  type ImageTagsReply,
} from '@nebula-home/contracts';

import { apiRequest } from '@/lib/api-client';

/** Where the containers are cached. */
export const CONTAINER_QUERY_KEYS = {
  all: ['containers'],
  list: ['containers', 'list'],
  /**
   * Where one container is cached.
   *
   * @param name - Its name.
   * @returns The key.
   */
  one: (name: string) => ['containers', 'one', name] as const,

  /**
   * Where one container's logs are cached.
   *
   * @param name - Its name.
   * @returns The key.
   */
  logs: (name: string) => ['containers', 'logs', name] as const,

  /**
   * Where the file of a compose project deployed from here is cached.
   *
   * @param project - The project.
   * @returns The key.
   */
  compose: (project: string) => ['containers', 'compose', project] as const,
} as const;

/** Where what the registries say is cached: it changes slowly, and is not the machine's. */
export const IMAGE_QUERY_KEYS = {
  /**
   * Where a search is cached.
   *
   * @param query - What was looked for.
   * @returns The key.
   */
  search: (query: string) => ['container-images', 'search', query] as const,

  /**
   * Where an image's tags are cached.
   *
   * @param image - The image.
   * @returns The key.
   */
  tags: (image: string) => ['container-images', 'tags', image] as const,

  /**
   * Where what an image declares is cached.
   *
   * @param image - The image.
   * @param tag - The tag.
   * @returns The key.
   */
  describe: (image: string, tag: string) => ['container-images', 'describe', image, tag] as const,
} as const;

/**
 * The path of one container.
 *
 * @param name - Its name.
 * @returns `/containers/<name>`.
 */
function pathOf(name: string): string {
  return `/containers/${encodeURIComponent(name)}`;
}

/**
 * The path of one compose project.
 *
 * @param project - The project.
 * @returns `/compose-projects/<project>`.
 */
function composePathOf(project: string): string {
  return `/compose-projects/${encodeURIComponent(project)}`;
}

/**
 * The signal, as the request options take it.
 *
 * @param signal - Cancels the request, when there is one.
 * @returns The options.
 */
function withSignal(signal: AbortSignal | undefined): { signal?: AbortSignal } {
  return signal === undefined ? {} : { signal };
}

/**
 * Reads every container, and whether Docker can be seen.
 *
 * @param signal - Cancels the request.
 * @returns Docker's status, the containers, and what is being installed or deployed.
 */
export async function fetchContainers(signal?: AbortSignal): Promise<ContainersView> {
  return apiRequest('/containers', containersViewSchema, withSignal(signal));
}

/**
 * Reads one container.
 *
 * @param name - Its name.
 * @param signal - Cancels the request.
 * @returns The container.
 */
export async function fetchContainer(name: string, signal?: AbortSignal): Promise<ContainerDetail> {
  return apiRequest(pathOf(name), containerDetailSchema, withSignal(signal));
}

/**
 * Reads the last lines a container wrote.
 *
 * @param name - Its name.
 * @param tail - How many lines.
 * @param signal - Cancels the request.
 * @returns The lines, oldest first.
 */
export async function fetchContainerLogs(
  name: string,
  tail: number,
  signal?: AbortSignal,
): Promise<ContainerLogsReply> {
  return apiRequest(
    `${pathOf(name)}/logs?tail=${String(tail)}`,
    containerLogsReplySchema,
    withSignal(signal),
  );
}

/**
 * Starts, stops or restarts a container.
 *
 * @param name - Its name.
 * @param action - What to do.
 * @returns The container as it now is.
 */
export async function controlContainer(
  name: string,
  action: ContainerAction,
): Promise<ContainerSummary> {
  return apiRequest(`${pathOf(name)}/${action}`, containerSummarySchema, { method: 'POST' });
}

/**
 * Starts updating a container to the newest image on offer.
 *
 * @param name - Its name.
 */
export async function updateContainer(name: string): Promise<void> {
  await apiRequest(`${pathOf(name)}/update`, z.unknown(), { method: 'POST' });
}

/**
 * Stops and removes a container.
 *
 * @param name - Its name.
 * @param removeVolumes - Also the volumes Docker made for it alone.
 */
export async function removeContainer(name: string, removeVolumes: boolean): Promise<void> {
  await apiRequest(`${pathOf(name)}?volumes=${String(removeVolumes)}`, z.unknown(), {
    method: 'DELETE',
  });
}

/**
 * Looks for images on Docker Hub.
 *
 * @param query - What to look for.
 * @param signal - Cancels the request.
 * @returns What Docker Hub found.
 */
export async function searchImages(query: string, signal?: AbortSignal): Promise<ImageSearchReply> {
  return apiRequest(
    `/container-images/search?q=${encodeURIComponent(query)}`,
    imageSearchReplySchema,
    withSignal(signal),
  );
}

/**
 * Reads the tags of an image worth offering.
 *
 * @param image - The image, without a tag.
 * @param signal - Cancels the request.
 * @returns The tags, the newest first.
 */
export async function fetchImageTags(image: string, signal?: AbortSignal): Promise<ImageTagsReply> {
  return apiRequest(
    `/container-images/tags?image=${encodeURIComponent(image)}`,
    imageTagsReplySchema,
    withSignal(signal),
  );
}

/**
 * Reads what an image declares: its ports, its environment, its volumes.
 *
 * @param image - The image, without a tag.
 * @param tag - The tag.
 * @param signal - Cancels the request.
 * @returns What it declares.
 */
export async function describeImage(
  image: string,
  tag: string,
  signal?: AbortSignal,
): Promise<ImageDescription> {
  return apiRequest(
    `/container-images/describe?image=${encodeURIComponent(image)}&tag=${encodeURIComponent(tag)}`,
    imageDescriptionSchema,
    withSignal(signal),
  );
}

/**
 * Starts installing a container; the list follows it.
 *
 * @param request - What the form said.
 */
export async function installContainer(request: ContainerInstallRequest): Promise<void> {
  await apiRequest('/containers', z.unknown(), { method: 'POST', body: request });
}

/**
 * Forgets an install that failed.
 *
 * @param name - The container's name.
 */
export async function dismissInstall(name: string): Promise<void> {
  await apiRequest(`/container-installs/${encodeURIComponent(name)}`, z.unknown(), {
    method: 'DELETE',
  });
}

/**
 * Checks a compose file without running anything.
 *
 * @param definition - The project, its file and its `.env`.
 * @returns What is wrong, and the services it declares.
 */
export async function validateCompose(definition: ComposeDefinition): Promise<ComposeValidation> {
  return apiRequest('/compose-projects/validate', composeValidationSchema, {
    method: 'POST',
    body: definition,
  });
}

/**
 * Keeps a compose file and brings its project up: a new project, or a change to one.
 *
 * @param definition - The project, its file and its `.env`.
 * @param isNew - Whether the project is new.
 */
export async function deployCompose(definition: ComposeDefinition, isNew: boolean): Promise<void> {
  await (isNew
    ? apiRequest('/compose-projects', z.unknown(), { method: 'POST', body: definition })
    : apiRequest(composePathOf(definition.project), z.unknown(), {
        method: 'PUT',
        body: { file: definition.file, env: definition.env },
      }));
}

/**
 * Reads the file and `.env` of a compose project deployed from here.
 *
 * @param project - The project.
 * @param signal - Cancels the request.
 * @returns Them.
 */
export async function fetchCompose(
  project: string,
  signal?: AbortSignal,
): Promise<ComposeDocument> {
  return apiRequest(composePathOf(project), composeDocumentSchema, withSignal(signal));
}

/**
 * Starts, stops, or pulls newer images for every service of a compose project.
 *
 * @param project - The project.
 * @param action - What to do.
 */
export async function controlCompose(
  project: string,
  action: 'start' | 'stop' | 'pull',
): Promise<void> {
  await apiRequest(`${composePathOf(project)}/${action}`, z.unknown(), { method: 'POST' });
}

/**
 * Takes a compose project down, and forgets it.
 *
 * @param project - The project.
 * @param removeVolumes - Also its volumes.
 * @param removeFiles - Also its folder.
 */
export async function removeCompose(
  project: string,
  removeVolumes: boolean,
  removeFiles: boolean,
): Promise<void> {
  await apiRequest(
    `${composePathOf(project)}?volumes=${String(removeVolumes)}&files=${String(removeFiles)}`,
    z.unknown(),
    { method: 'DELETE' },
  );
}
