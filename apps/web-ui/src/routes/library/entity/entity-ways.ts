/**
 * How an entity read two ways is read: each way's name and its key in that transport
 * (`switch:0`, "EP1 · On/Off"), which is read first and which is in use - for the dialog's
 * settings, where the way read first is chosen.
 */
import { useTranslation } from 'react-i18next';

import type { EntitySource, EntityView, MatterReference } from '@nebulahome/contracts';

import { useVendorsById, wayName, type TransportWay } from '@/routes/library/transport-marks';

/** The clusters a Matter reading is named by, as people say them. */
const CLUSTER_NAMES: Readonly<Record<number, string>> = {
  0x00_06: 'On/Off',
  0x00_08: 'Level',
  0x01_02: 'Window covering',
  0x02_01: 'Thermostat',
  0x03_00: 'Colour',
  0x04_02: 'Temperature',
  0x04_05: 'Humidity',
  0x04_06: 'Occupancy',
  0x00_90: 'Power',
  0x00_91: 'Energy',
};

/**
 * A Matter reading's place: "EP1 · On/Off".
 *
 * @param reference - Where it sits.
 * @returns The words.
 */
export function matterKeyOf(reference: MatterReference): string {
  const cluster =
    CLUSTER_NAMES[reference.cluster] ??
    `0x${reference.cluster.toString(16).toUpperCase().padStart(4, '0')}`;

  return `EP${String(reference.endpoint)} · ${cluster}`;
}

/** One source, with what the dialog says of it. */
export type EntityWay = {
  readonly source: EntitySource;
  readonly way: TransportWay;
  readonly name: string;

  /** Its key in its transport, or where it sits in Matter. */
  readonly key: string | null;
};

/** How an entity read two ways is read. */
export type EntityWays = {
  readonly sources: readonly EntityWay[];

  /** The source read first: the entity's own choice, else its device's. */
  readonly first: EntityWay;
  readonly second: EntityWay;

  /** The one read now, or null when none answers. */
  readonly active: EntityWay | null;

  /** Whether the entity chose its own way rather than follow the device. */
  readonly isOwnChoice: boolean;
};

/**
 * Reads how an entity read two ways is read.
 *
 * @param entity - The entity, once it is read.
 * @returns How, or null for an entity read one way, or not read yet.
 */
export function useEntityWays(entity: Pick<EntityView, 'linked'> | undefined): EntityWays | null {
  const { t } = useTranslation();
  const vendors = useVendorsById();
  const linked = entity?.linked;

  if (linked == null) {
    return null;
  }

  const sources = linked.sources.map((source) => {
    const way = { vendorId: source.vendorId, transport: source.transport };

    return {
      source,
      way,
      name: wayName(way, vendors, t('library.matterTag', 'Matter')),
      key: source.matter === null ? source.key : matterKeyOf(source.matter),
    };
  });
  const firstId = linked.transport ?? linked.preferred;
  const first = sources.find((each) => each.source.deviceId === firstId) ?? sources[0];
  const second = sources.find((each) => each !== first) ?? sources[1];

  if (first === undefined || second === undefined) {
    return null;
  }

  return {
    sources,
    first,
    second,
    active: sources.find((each) => each.source.isActive) ?? null,
    isOwnChoice: linked.transport !== null,
  };
}
