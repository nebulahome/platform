/**
 * A Matter node as the platform reads it: its attributes, the devices it is in the house, and who
 * each of them says it is.
 *
 * The hub's controller hands every node over as one flat record of attributes, keyed
 * `<endpoint>/<cluster>/<attribute>` by number - the form the Matter Server answers in, structs
 * keyed by their fields' numbers - so nothing here depends on the controller's
 * library: the same functions read a node in the hub, in a driver and in a test.
 *
 * **One node, one or more devices.** A node is a device of the house, endpoints and all - except a
 * bridge's, where each endpoint of the Bridged Node type (and the endpoints under it) is a device
 * of its own, with its own names, behind the bridge. The bridge itself stays one device: what its
 * root endpoint says, its firmware.
 */
import type { MatterIdentity } from '@nebulahome/contracts';

/** Every attribute of a node, keyed `<endpoint>/<cluster>/<attribute>`. */
export type MatterAttributes = Readonly<Record<string, unknown>>;

/** A node, as the controller hands it over. */
export type MatterNodeSnapshot = {
  /** In decimal: a 64-bit number. */
  readonly nodeId: string;
  readonly isAvailable: boolean;
  readonly attributes: MatterAttributes;
};

/** One device a node is in the house: which endpoints are its own. */
export type MatterScope = {
  /** The bridged endpoint it is; null for the node itself. */
  readonly endpoint: number | null;

  /** Its endpoints, in order: the bridged one first, then those under it. */
  readonly endpoints: readonly number[];
};

/** The clusters this module reads by number, and the platform maps. */
export const CLUSTER = {
  identify: 3,
  onOff: 6,
  levelControl: 8,
  descriptor: 29,
  basicInformation: 40,
  otaRequestor: 42,
  powerSource: 47,
  generalDiagnostics: 51,
  bridgedBasicInformation: 57,
  booleanState: 69,
  electricalPowerMeasurement: 144,
  electricalEnergyMeasurement: 145,
  doorLock: 257,
  windowCovering: 258,
  thermostat: 513,
  colorControl: 768,
  illuminanceMeasurement: 1024,
  temperatureMeasurement: 1026,
  pressureMeasurement: 1027,
  relativeHumidityMeasurement: 1029,
  occupancySensing: 1030,
  carbonDioxideMeasurement: 1037,
} as const;

/** The device types this module tells apart, by number. */
export const DEVICE_TYPE = {
  aggregator: 14,
  bridgedNode: 19,
  contactSensor: 21,
  waterLeakDetector: 67,
  onOffLight: 256,
  dimmableLight: 257,
  onOffPlugInUnit: 266,
  dimmablePlugInUnit: 267,
  colorTemperatureLight: 268,
  extendedColorLight: 269,
  mountedDimmableLoadControl: 272,
} as const;

/** The attributes of the information clusters, which the bridged one shares the numbers of. */
const INFO = {
  vendorName: 1,
  vendorId: 2,
  productName: 3,
  productId: 4,
  nodeLabel: 5,
  hardwareVersion: 7,
  hardwareVersionString: 8,
  softwareVersion: 9,
  softwareVersionString: 10,
  productLabel: 14,
  serialNumber: 15,
  reachable: 17,
  uniqueId: 18,
} as const;

/** The Descriptor's attributes. */
const DESCRIPTOR = { deviceTypeList: 0, serverList: 1, partsList: 3 } as const;

/** General Diagnostics' list of network interfaces, and the field of each that is its address. */
const NETWORK_INTERFACES = 0;
const HARDWARE_ADDRESS_FIELD = '4';

/**
 * The key of one attribute.
 *
 * @param endpoint - The endpoint.
 * @param cluster - The cluster.
 * @param attribute - The attribute.
 * @returns `<endpoint>/<cluster>/<attribute>`.
 */
export function attributePath(endpoint: number, cluster: number, attribute: number): string {
  return `${String(endpoint)}/${String(cluster)}/${String(attribute)}`;
}

/**
 * Reads one attribute.
 *
 * @param attributes - The node's.
 * @param endpoint - The endpoint.
 * @param cluster - The cluster.
 * @param attribute - The attribute.
 * @returns Its value, or undefined when the node has none there.
 */
export function attributeOf(
  attributes: MatterAttributes,
  endpoint: number,
  cluster: number,
  attribute: number,
): unknown {
  return attributes[attributePath(endpoint, cluster, attribute)];
}

/**
 * Splits an attribute's key.
 *
 * @param path - `<endpoint>/<cluster>/<attribute>`.
 * @returns Its three numbers, or undefined for a key of another shape.
 */
export function splitPath(
  path: string,
): { readonly endpoint: number; readonly cluster: number; readonly attribute: number } | undefined {
  const [endpoint, cluster, attribute, rest] = path.split('/').map(Number);

  return rest === undefined &&
    Number.isInteger(endpoint) &&
    Number.isInteger(cluster) &&
    Number.isInteger(attribute)
    ? { endpoint: endpoint ?? 0, cluster: cluster ?? 0, attribute: attribute ?? 0 }
    : undefined;
}

/**
 * The numbers in a list attribute.
 *
 * @param value - The attribute.
 * @returns Its numbers; none for anything that is not a list of numbers.
 */
function numbersOf(value: unknown): number[] {
  return Array.isArray(value)
    ? value.filter((item): item is number => typeof item === 'number')
    : [];
}

/**
 * The endpoints a node has, from the keys of its attributes.
 *
 * @param attributes - The node's.
 * @returns Every endpoint, ascending.
 */
export function endpointsOf(attributes: MatterAttributes): number[] {
  const found = new Set<number>();

  for (const path of Object.keys(attributes)) {
    const split = splitPath(path);

    if (split !== undefined) {
      found.add(split.endpoint);
    }
  }

  return [...found].sort((a, b) => a - b);
}

/**
 * The device types an endpoint declares.
 *
 * @param attributes - The node's.
 * @param endpoint - The endpoint.
 * @returns Their numbers.
 */
export function deviceTypesOf(attributes: MatterAttributes, endpoint: number): number[] {
  const list = attributeOf(attributes, endpoint, CLUSTER.descriptor, DESCRIPTOR.deviceTypeList);

  return Array.isArray(list)
    ? list.flatMap((entry: unknown) => {
        const type = (entry as Record<string, unknown> | null)?.['0'];

        return typeof type === 'number' ? [type] : [];
      })
    : [];
}

/**
 * The clusters an endpoint serves.
 *
 * @param attributes - The node's.
 * @param endpoint - The endpoint.
 * @returns Their numbers, from its Descriptor's server list - or, when that was not read, from the
 * clusters it has attributes of.
 */
export function clustersOf(attributes: MatterAttributes, endpoint: number): number[] {
  const listed = numbersOf(
    attributeOf(attributes, endpoint, CLUSTER.descriptor, DESCRIPTOR.serverList),
  );

  if (listed.length > 0) {
    return listed;
  }

  const found = new Set<number>();

  for (const path of Object.keys(attributes)) {
    const split = splitPath(path);

    if (split?.endpoint === endpoint) {
      found.add(split.cluster);
    }
  }

  return [...found];
}

/**
 * Whether an endpoint serves a cluster.
 *
 * @param attributes - The node's.
 * @param endpoint - The endpoint.
 * @param cluster - The cluster.
 * @returns True when it does.
 */
export function serves(attributes: MatterAttributes, endpoint: number, cluster: number): boolean {
  return clustersOf(attributes, endpoint).includes(cluster);
}

/**
 * The devices a node is in the house: the node itself, and each device behind it when it bridges.
 *
 * @param attributes - The node's.
 * @returns The node first, then each bridged device by its endpoint.
 */
export function scopesOf(attributes: MatterAttributes): MatterScope[] {
  const endpoints = endpointsOf(attributes);
  const bridged = endpoints.filter((endpoint) =>
    deviceTypesOf(attributes, endpoint).includes(DEVICE_TYPE.bridgedNode),
  );
  const owned = new Set<number>();
  const scopes = bridged.map((endpoint): MatterScope => {
    const parts = numbersOf(
      attributeOf(attributes, endpoint, CLUSTER.descriptor, DESCRIPTOR.partsList),
    ).filter((part) => endpoints.includes(part) && !bridged.includes(part));
    const own = [endpoint, ...parts];

    for (const each of own) {
      owned.add(each);
    }

    return { endpoint, endpoints: own };
  });

  return [
    { endpoint: null, endpoints: endpoints.filter((endpoint) => !owned.has(endpoint)) },
    ...scopes,
  ];
}

/**
 * The device an endpoint belongs to.
 *
 * @param scopes - The node's devices.
 * @param endpoint - The endpoint.
 * @returns Its device, or the node's own when no bridged device holds it.
 */
export function scopeOfEndpoint(scopes: readonly MatterScope[], endpoint: number): MatterScope {
  return (
    scopes.find((scope) => scope.endpoint !== null && scope.endpoints.includes(endpoint)) ??
    scopes[0] ?? { endpoint: null, endpoints: [] }
  );
}

/**
 * The key the transport and the driver agree a device is reached by.
 *
 * @param nodeId - The node.
 * @param endpoint - The bridged endpoint, or null for the node itself.
 * @returns `<node>` or `<node>:<endpoint>`.
 */
export function matterDeviceKey(nodeId: string, endpoint: number | null): string {
  return endpoint === null ? nodeId : `${nodeId}:${String(endpoint)}`;
}

/**
 * A text attribute, trimmed.
 *
 * @param value - The attribute.
 * @returns It, or null when it is not a text with something in it.
 */
function textOf(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim().slice(0, 256) : null;
}

/**
 * A number attribute.
 *
 * @param value - The attribute.
 * @returns It, or null when it is not a whole number at or above zero.
 */
function countOf(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}

/**
 * A hardware address, as the controller hands an octet string over (base64), written the way a
 * router's page shows it.
 *
 * @param value - The field.
 * @returns `aa:bb:cc:dd:ee:ff`, or null when it is no address.
 */
function macOf(value: unknown): string | null {
  if (typeof value !== 'string' || value === '') {
    return null;
  }

  const bytes = Buffer.from(value, 'base64');

  // A Thread interface has an 8-byte extended address; anything else is not an address at all.
  return bytes.length === 6 || bytes.length === 8
    ? [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join(':')
    : null;
}

/**
 * Who one device of a node says it is.
 *
 * @param node - The node.
 * @param scope - Which of its devices.
 * @returns Its identity: the node's Basic Information for the node itself, the Bridged Device
 * Basic Information of its endpoint for a device behind a bridge.
 */
export function identityOf(node: MatterNodeSnapshot, scope: MatterScope): MatterIdentity {
  const { attributes } = node;
  const isBridged = scope.endpoint !== null;
  const endpoint = scope.endpoint ?? 0;
  const cluster = isBridged ? CLUSTER.bridgedBasicInformation : CLUSTER.basicInformation;

  /**
   * Reads one field of the information cluster.
   *
   * @param attribute - Its number.
   * @returns Its value.
   */
  const info = (attribute: number): unknown =>
    attributeOf(attributes, endpoint, cluster, attribute);
  const interfaces = isBridged
    ? []
    : attributeOf(attributes, 0, CLUSTER.generalDiagnostics, NETWORK_INTERFACES);
  const macAddresses = Array.isArray(interfaces)
    ? interfaces.flatMap((entry: unknown) => {
        const mac = macOf((entry as Record<string, unknown> | null)?.[HARDWARE_ADDRESS_FIELD]);

        return mac === null ? [] : [mac];
      })
    : [];
  const deviceTypes = new Set<number>();
  const clusters = new Set<number>();

  for (const each of scope.endpoints) {
    for (const type of deviceTypesOf(attributes, each)) {
      deviceTypes.add(type);
    }

    for (const served of clustersOf(attributes, each)) {
      clusters.add(served);
    }
  }

  return {
    nodeId: node.nodeId,
    endpoint: scope.endpoint,
    vendorId: countOf(info(INFO.vendorId)),
    productId: countOf(info(INFO.productId)),
    vendorName: textOf(info(INFO.vendorName)),
    productName: textOf(info(INFO.productName)),
    productLabel: textOf(info(INFO.productLabel)),
    nodeLabel: textOf(info(INFO.nodeLabel)),
    serialNumber: textOf(info(INFO.serialNumber)),
    uniqueId: textOf(info(INFO.uniqueId)),
    hardwareVersion: countOf(info(INFO.hardwareVersion)),
    hardwareVersionString: textOf(info(INFO.hardwareVersionString)),
    softwareVersion: countOf(info(INFO.softwareVersion)),
    softwareVersionString: textOf(info(INFO.softwareVersionString)),
    macAddresses: [...new Set(macAddresses)].slice(0, 64),
    deviceTypes: [...deviceTypes].slice(0, 64),
    clusters: [...clusters].sort((a, b) => a - b).slice(0, 256),
    isBridge: endpointsOf(attributes).some((each) =>
      deviceTypesOf(attributes, each).includes(DEVICE_TYPE.aggregator),
    ),
    isBridged,
  };
}

/**
 * Whether one device of a node answers: the node, and for a device behind a bridge what the bridge
 * says of it.
 *
 * @param node - The node.
 * @param scope - Which of its devices.
 * @returns False when the node is gone or the bridge says the device is not reachable.
 */
export function isReachable(node: MatterNodeSnapshot, scope: MatterScope): boolean {
  if (!node.isAvailable) {
    return false;
  }

  return (
    scope.endpoint === null ||
    attributeOf(
      node.attributes,
      scope.endpoint,
      CLUSTER.bridgedBasicInformation,
      INFO.reachable,
    ) !== false
  );
}

/**
 * The name a device of a node is offered under.
 *
 * @param identity - Who it says it is.
 * @returns What the owner named it in the app it came from, then what it is sold as.
 */
export function nameOf(identity: MatterIdentity): string {
  return (
    identity.nodeLabel ??
    identity.productLabel ??
    identity.productName ??
    `Matter device ${identity.endpoint === null ? identity.nodeId : `${identity.nodeId}:${String(identity.endpoint)}`}`
  );
}

/** The attributes of a device's endpoints, and of the node's root for its firmware. */
export type MatterDeviceSnapshot = {
  readonly nodeId: string;
  readonly endpoint: number | null;
  readonly endpoints: readonly number[];
  readonly isAvailable: boolean;
  readonly identity: MatterIdentity;
  readonly attributes: MatterAttributes;
};

/**
 * One device of a node, as what identification reads and a driver maps.
 *
 * @param node - The node.
 * @param scope - Which of its devices.
 * @returns Its attributes - the endpoints that are its own, and endpoint 0's firmware attributes
 * for the node itself - with who it is and whether it answers.
 */
export function deviceSnapshotOf(
  node: MatterNodeSnapshot,
  scope: MatterScope,
): MatterDeviceSnapshot {
  const own = new Set(scope.endpoints);
  const attributes: Record<string, unknown> = {};

  for (const [path, value] of Object.entries(node.attributes)) {
    const split = splitPath(path);

    if (split !== undefined && own.has(split.endpoint)) {
      attributes[path] = value;
    }
  }

  return {
    nodeId: node.nodeId,
    endpoint: scope.endpoint,
    endpoints: scope.endpoints,
    isAvailable: isReachable(node, scope),
    identity: identityOf(node, scope),
    attributes,
  };
}
