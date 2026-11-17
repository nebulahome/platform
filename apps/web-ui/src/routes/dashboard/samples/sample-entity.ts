/**
 * How a sample entity is written: the registry's row with only what a card reads filled in.
 */
import {
  entityIdSchema,
  type EntityCapability,
  type EntityView,
  type JsonObject,
} from '@nebulahome/contracts';

/** When every sample last changed: twenty-four minutes before the page opened. */
const CHANGED = new Date(Date.now() - 24 * 60_000);

/** What a sample entity is made of. */
export type SampleEntity = {
  readonly name: string;
  readonly area: string | null;
  readonly capabilities: readonly EntityCapability[];
  readonly state: JsonObject;
  readonly unit?: string;
  readonly deviceClass?: string;
  readonly isAvailable?: boolean;

  /** Whether it is drawn for someone who may only look at it. */
  readonly isViewOnly?: boolean;

  /** Whether it was switched off in Devices. */
  readonly isDisabled?: boolean;
};

/** The source of a sample drawn for someone who may only look at it. */
export const VIEW_ONLY_SOURCE = 'sample-view-only';

/**
 * A sample entity, as the registry would list it.
 *
 * @param entityId - Its address.
 * @param sample - What it is.
 * @returns The entity.
 */
export function sampleEntity(entityId: string, sample: SampleEntity): EntityView {
  return {
    entityId: entityIdSchema.parse(entityId),
    domain: entityId.split('.')[0] ?? 'sensor',
    name: sample.name,
    icon: null,
    areaKey: null,
    areaName: sample.area,
    deviceId: null,
    source: sample.isViewOnly === true ? VIEW_ONLY_SOURCE : 'sample',
    unitOfMeasurement: sample.unit ?? null,
    deviceClass: sample.deviceClass ?? null,
    isEnabled: sample.isDisabled !== true,
    isHidden: false,
    capabilities: [...sample.capabilities],
    searchAliases: [],
    state: sample.state,
    attributes: {},
    isAvailable: sample.isAvailable ?? true,
    lastChanged: CHANGED,
    lastUpdated: CHANGED,
    tagIds: [],
    addresses: [],
    linked: null,
    key: null,
    createdAt: null,
    original: null,
  };
}

/**
 * One capability with its params.
 *
 * @param capability - Its name.
 * @param params - What the device declared.
 * @returns The entry.
 */
export function can(
  capability: EntityCapability['capability'],
  params: EntityCapability['params'] = {},
): EntityCapability {
  return { capability, params };
}
