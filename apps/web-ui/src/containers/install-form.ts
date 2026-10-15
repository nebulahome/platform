/**
 * The install form's state, and what it becomes: the request that installs a container.
 *
 * The form holds text - a port being typed is not a number yet - and the rows the owner adds and
 * takes away, each with a key of its own so a row keeps its focus when the one above it goes.
 * What an image declares fills it in when the image is picked: its ports, published on the same
 * number; its environment, as the image sets it; its volumes, kept in NebulaHome's data so a
 * backup takes them. Pure, so the form is tested without the dialog.
 */
import {
  containerInstallRequestSchema,
  CONTAINER_NAME_PATTERN,
  type ContainerInstallRequest,
  type ImageDescription,
  type InstallNetwork,
  type RestartPolicy,
} from '@nebulahome/contracts';

import { translate } from '@/i18n/messages';

/** One port row. */
export type PortDraft = {
  readonly key: string;
  readonly host: string;
  readonly container: string;
  readonly protocol: 'tcp' | 'udp';
};

/** One environment row. */
export type EnvDraft = { readonly key: string; readonly name: string; readonly value: string };

/** Where a folder of the container is kept. */
export type VolumeKind = 'data' | 'volume' | 'bind';

/** One folder row. */
export type VolumeDraft = {
  readonly key: string;
  readonly kind: VolumeKind;

  /** The folder's name in NebulaHome's data, the volume's name, or the machine's path. */
  readonly source: string;
  readonly target: string;
  readonly isReadOnly: boolean;
};

/** A device of the machine handed to the container, as the form holds it. */
export type DeviceDraft = {
  readonly key: string;

  /** Its path on the machine: `/dev/ttyUSB0`. */
  readonly host: string;

  /** Where the container sees it; the same path when left blank. */
  readonly container: string;
};

/** Everything the form holds. */
export type InstallDraft = {
  readonly image: string;
  readonly tag: string;
  readonly name: string;
  readonly network: InstallNetwork;
  readonly restartPolicy: RestartPolicy;
  readonly ports: readonly PortDraft[];
  readonly env: readonly EnvDraft[];
  readonly volumes: readonly VolumeDraft[];
  readonly devices: readonly DeviceDraft[];
};

/** The form before anything is picked. */
export const EMPTY_INSTALL: InstallDraft = {
  image: '',
  tag: 'latest',
  name: '',
  network: 'bridge',
  restartPolicy: 'unless-stopped',
  ports: [],
  env: [],
  volumes: [],
  devices: [],
};

/** The last key handed out. */
let lastKey = 0;

/**
 * A key for a new row.
 *
 * @returns One no row has had.
 */
export function rowKey(): string {
  lastKey += 1;

  return `row-${String(lastKey)}`;
}

/**
 * A name made of what Docker allows: the image's own name, lower case, anything else a dash.
 *
 * @param text - What to make a name of.
 * @returns The name, never empty.
 */
function nameOf(text: string): string {
  const name = text
    .toLowerCase()
    .replaceAll(/[^a-z0-9_.-]+/g, '-')
    .replaceAll(/^[^a-z0-9]+|-+$/g, '')
    .slice(0, 64);

  return name === '' ? 'container' : name;
}

/**
 * The name a container of an image is offered: the image's name, numbered when taken.
 *
 * @param image - The image, without a tag: `linuxserver/jellyfin`.
 * @param taken - The names containers already have.
 * @returns `jellyfin`, or `jellyfin-2` when that is taken.
 */
export function suggestName(image: string, taken: readonly string[]): string {
  const base = nameOf(image.split('/').pop() ?? image);

  if (!taken.includes(base)) {
    return base;
  }

  for (let number = 2; ; number += 1) {
    const candidate = `${base}-${String(number)}`;

    if (!taken.includes(candidate)) {
      return candidate;
    }
  }
}

/**
 * The form for a picked image: named after it, the rest as it was.
 *
 * @param draft - The form.
 * @param image - The image, without a tag.
 * @param taken - The names containers already have.
 * @returns The form.
 */
export function pickImage(
  draft: InstallDraft,
  image: string,
  taken: readonly string[],
): InstallDraft {
  return {
    ...draft,
    image,
    tag: 'latest',
    name: suggestName(image, taken),
    ports: [],
    env: [],
    volumes: [],
  };
}

/**
 * The folder name a volume path is kept under in NebulaHome's data.
 *
 * @param path - The path in the container: `/config`.
 * @param used - The names already given.
 * @returns `config`, numbered when used.
 */
function folderNameOf(path: string, used: readonly string[]): string {
  const base =
    (path.split('/').findLast((part) => part !== '') ?? 'data')
      .toLowerCase()
      .replaceAll(/[^a-z0-9_-]+/g, '-')
      .replaceAll(/^[^a-z0-9]+|-+$/g, '')
      .slice(0, 28) || 'data';

  let name = base;

  for (let number = 2; used.includes(name); number += 1) {
    name = `${base}-${String(number)}`;
  }

  return name;
}

/**
 * Fills the form in from what the image declares: its ports, its environment, its volumes.
 *
 * @param draft - The form.
 * @param description - What the image declares.
 * @returns The form, with a row for each.
 */
export function applyDescription(draft: InstallDraft, description: ImageDescription): InstallDraft {
  const names: string[] = [];

  return {
    ...draft,
    ports: description.ports.map((port) => ({
      key: rowKey(),
      host: String(port.container),
      container: String(port.container),
      protocol: port.protocol,
    })),
    env: description.env.map((entry) => ({ key: rowKey(), name: entry.name, value: entry.value })),
    volumes: description.volumes.map((target) => {
      const source = folderNameOf(target, names);

      names.push(source);

      return { key: rowKey(), kind: 'data' as const, source, target, isReadOnly: false };
    }),
  };
}

/** What checking the form gives: the request, or what is wrong, by the field's path. */
export type InstallCheck =
  | { readonly request: ContainerInstallRequest; readonly errors: null }
  | { readonly request: null; readonly errors: Readonly<Record<string, string>> };

/**
 * A port as the form holds it, as a number.
 *
 * @param text - What was typed.
 * @returns The number, or NaN for something that is not one.
 */
function portOf(text: string): number {
  return /^\d+$/.test(text.trim()) ? Number(text.trim()) : Number.NaN;
}

/**
 * Checks the form and makes the request of it.
 *
 * @param draft - The form.
 * @param taken - The names containers already have.
 * @returns The request, or what is wrong: `name`, `ports.0.host`, `env.2.name`.
 */
export function checkInstall(draft: InstallDraft, taken: readonly string[]): InstallCheck {
  const request = {
    name: draft.name.trim(),
    image: draft.image.trim(),
    tag: draft.tag.trim(),
    ports: draft.ports.map((port) => ({
      host: portOf(port.host),
      container: portOf(port.container),
      protocol: port.protocol,
    })),
    env: draft.env
      .filter((entry) => entry.name.trim() !== '' || entry.value !== '')
      .map((entry) => ({ name: entry.name.trim(), value: entry.value })),
    volumes: draft.volumes.map((volume) =>
      volume.kind === 'bind'
        ? {
            kind: volume.kind,
            source: volume.source.trim(),
            target: volume.target.trim(),
            isReadOnly: volume.isReadOnly,
          }
        : {
            kind: volume.kind,
            name: volume.source.trim(),
            target: volume.target.trim(),
            isReadOnly: volume.isReadOnly,
          },
    ),
    devices: draft.devices
      .filter((device) => device.host.trim() !== '' || device.container.trim() !== '')
      .map((device) => ({
        host: device.host.trim(),
        container: device.container.trim() === '' ? device.host.trim() : device.container.trim(),
      })),
    restartPolicy: draft.restartPolicy,
    network: draft.network,
  };
  const errors: Record<string, string> = {};
  const parsed = containerInstallRequestSchema.safeParse(request);

  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      // A folder's name and a machine's path are one field of the row: its source.
      const path =
        issue.path[0] === 'volumes' && issue.path[2] === 'name'
          ? `volumes.${String(issue.path[1])}.source`
          : issue.path.join('.');

      errors[path] ??=
        issue.path[0] === 'ports' &&
        (issue.path.at(-1) === 'host' || issue.path.at(-1) === 'container')
          ? translate('containers.installForm.portFrom1To', 'A port from 1 to 65535')
          : issue.path[0] === 'devices'
            ? translate(
                'containers.installForm.pathOnTheMachine',
                'A path on the machine, such as /dev/ttyUSB0',
              )
            : issue.message;
    }
  }

  if (request.name !== '' && !CONTAINER_NAME_PATTERN.test(request.name)) {
    errors['name'] = translate(
      'containers.installForm.lettersDigitsDotsDashes',
      'Letters, digits, dots, dashes and underscores, starting with a letter or digit',
    );
  } else if (taken.includes(request.name)) {
    errors['name'] = translate(
      'containers.installForm.containerIsAlreadyCalled',
      'A container is already called that',
    );
  } else if (request.name === '') {
    errors['name'] = translate(
      'containers.installForm.containerNeedsAName',
      'The container needs a name',
    );
  }

  if (request.image === '') {
    errors['image'] = translate(
      'containers.installForm.pickAnImageOr',
      'Pick an image, or type one',
    );
  }

  return Object.keys(errors).length > 0 || !parsed.success
    ? { request: null, errors }
    : { request: parsed.data, errors: null };
}
