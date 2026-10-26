import { z } from "zod";
//#region ../contracts/dist/capabilities.d.ts
/** Every capability an entity may declare. */
declare const CAPABILITIES: readonly ["on_off", "level", "color_hs", "color_temp", "cover", "lock", "thermostat", "sensor_numeric", "sensor_binary", "sensor_text", "media_player", "camera", "button", "update", "lawn_mower", "select", "number", "vacuum", "image", "custom"];
/** The name of a single capability. */
type CapabilityName = (typeof CAPABILITIES)[number];
/**
 * The composite state of an entity: one entry per capability it declares.
 *
 * An entity is rarely one capability. A dimmable colour bulb is `on_off` plus `level` plus
 * `color_hs`, and its state carries all three, which is why this is a partial record rather
 * than a discriminated union - a union could only ever describe one of them at a time.
 */
declare const capabilityStateSchema: z.ZodObject<{
  on_off: z.ZodOptional<z.ZodObject<{
    isOn: z.ZodBoolean;
  }, z.core.$strip>>;
  level: z.ZodOptional<z.ZodObject<{
    level: z.ZodNumber;
  }, z.core.$strip>>;
  color_hs: z.ZodOptional<z.ZodObject<{
    hue: z.ZodNumber;
    saturation: z.ZodNumber;
  }, z.core.$strip>>;
  color_temp: z.ZodOptional<z.ZodObject<{
    mireds: z.ZodInt;
  }, z.core.$strip>>;
  cover: z.ZodOptional<z.ZodObject<{
    position: z.ZodNumber;
    tilt: z.ZodOptional<z.ZodNumber>;
    motion: z.ZodEnum<{
      opening: "opening";
      closing: "closing";
      stopped: "stopped";
    }>;
  }, z.core.$strip>>;
  lock: z.ZodOptional<z.ZodObject<{
    lockState: z.ZodEnum<{
      locked: "locked";
      unlocked: "unlocked";
      jammed: "jammed";
    }>;
  }, z.core.$strip>>;
  thermostat: z.ZodOptional<z.ZodObject<{
    currentTemperature: z.ZodNumber;
    targetTemperature: z.ZodNumber;
    mode: z.ZodEnum<{
      off: "off";
      heat: "heat";
      cool: "cool";
      auto: "auto";
      fan_only: "fan_only";
      dry: "dry";
    }>;
    action: z.ZodEnum<{
      off: "off";
      idle: "idle";
      heating: "heating";
      cooling: "cooling";
      drying: "drying";
      fan: "fan";
    }>;
    humidity: z.ZodOptional<z.ZodNumber>;
  }, z.core.$strip>>;
  sensor_numeric: z.ZodOptional<z.ZodObject<{
    value: z.ZodNumber;
  }, z.core.$strip>>;
  sensor_binary: z.ZodOptional<z.ZodObject<{
    isOn: z.ZodBoolean;
  }, z.core.$strip>>;
  sensor_text: z.ZodOptional<z.ZodObject<{
    value: z.ZodString;
  }, z.core.$strip>>;
  media_player: z.ZodOptional<z.ZodObject<{
    playback: z.ZodEnum<{
      stopped: "stopped";
      idle: "idle";
      playing: "playing";
      paused: "paused";
      buffering: "buffering";
    }>;
    volume: z.ZodNumber;
    isMuted: z.ZodBoolean;
    source: z.ZodOptional<z.ZodString>;
    mediaTitle: z.ZodOptional<z.ZodString>;
    mediaArtist: z.ZodOptional<z.ZodString>;
    mediaDurationSeconds: z.ZodOptional<z.ZodNumber>;
    mediaPositionSeconds: z.ZodOptional<z.ZodNumber>;
  }, z.core.$strip>>;
  camera: z.ZodOptional<z.ZodObject<{
    isStreamAvailable: z.ZodBoolean;
    snapshotPath: z.ZodOptional<z.ZodString>;
    isRecording: z.ZodDefault<z.ZodBoolean>;
  }, z.core.$strip>>;
  button: z.ZodOptional<z.ZodObject<{}, z.core.$strip>>;
  update: z.ZodOptional<z.ZodObject<{
    installedVersion: z.ZodDefault<z.ZodNullable<z.ZodString>>;
    latestVersion: z.ZodDefault<z.ZodNullable<z.ZodString>>;
    isInstalling: z.ZodDefault<z.ZodBoolean>;
    progress: z.ZodDefault<z.ZodNullable<z.ZodNumber>>;
  }, z.core.$strip>>;
  lawn_mower: z.ZodOptional<z.ZodObject<{
    activity: z.ZodEnum<{
      error: "error";
      idle: "idle";
      paused: "paused";
      mowing: "mowing";
      returning: "returning";
      docked: "docked";
    }>;
    isResumable: z.ZodDefault<z.ZodBoolean>;
  }, z.core.$strip>>;
  select: z.ZodOptional<z.ZodObject<{
    option: z.ZodDefault<z.ZodNullable<z.ZodString>>;
  }, z.core.$strip>>;
  number: z.ZodOptional<z.ZodObject<{
    value: z.ZodDefault<z.ZodNullable<z.ZodNumber>>;
  }, z.core.$strip>>;
  vacuum: z.ZodOptional<z.ZodObject<{
    activity: z.ZodEnum<{
      error: "error";
      idle: "idle";
      paused: "paused";
      returning: "returning";
      docked: "docked";
      cleaning: "cleaning";
    }>;
    rooms: z.ZodDefault<z.ZodArray<z.ZodObject<{
      id: z.ZodString;
      name: z.ZodString;
    }, z.core.$strip>>>;
    isResumable: z.ZodDefault<z.ZodBoolean>;
  }, z.core.$strip>>;
  image: z.ZodOptional<z.ZodObject<{
    contentType: z.ZodEnum<{
      "image/svg+xml": "image/svg+xml";
      "image/png": "image/png";
      "image/jpeg": "image/jpeg";
    }>;
    revision: z.ZodString;
    width: z.ZodOptional<z.ZodInt>;
    height: z.ZodOptional<z.ZodInt>;
  }, z.core.$strip>>;
  custom: z.ZodOptional<z.ZodObject<{
    values: z.ZodRecord<z.ZodString, z.ZodUnion<readonly [z.ZodString, z.ZodNumber, z.ZodBoolean, z.ZodNull]>>;
  }, z.core.$strip>>;
}, z.core.$strip>;
/** The composite state of an entity, keyed by capability. */
type CapabilityState = z.output<typeof capabilityStateSchema>;
//#endregion
//#region ../contracts/dist/json.d.ts
/**
 * A JSON object, the shape most `jsonb` columns actually hold.
 *
 * Written as an index signature rather than `Record<string, JsonValue>` because `Record` is a
 * mapped type, which TypeScript resolves eagerly and therefore cannot use in the recursive
 * definition below (TS2456). The index signature is deferred, so it can.
 */
type JsonObject = {
  [key: string]: JsonValue;
};
/** Any value that survives a JSON round trip unchanged. */
type JsonValue = string | number | boolean | null | JsonValue[] | JsonObject;
//#endregion
//#region ../contracts/dist/entity-id.d.ts
/** The kinds of thing an entity can be. The domain is the part before the dot. */
declare const ENTITY_DOMAINS: readonly ["light", "switch", "sensor", "binary_sensor", "cover", "lock", "climate", "media_player", "camera", "button", "update", "lawn_mower", "select", "number", "vacuum", "image", "custom", "alias"];
/** The kind of thing an entity is. */
type EntityDomain = (typeof ENTITY_DOMAINS)[number];
/**
 * Validates an entity identifier and brands the result.
 *
 * The brand means an `EntityId` cannot be produced from a bare string without going through
 * validation. Identifiers reach the database as primary lookups and NATS as subject tokens, so
 * an unvalidated one does not fail where it was created - it fails somewhere else, later.
 */
declare const entityIdSchema: z.core.$ZodBranded<z.ZodString, "EntityId", "out">;
/** A validated `<domain>.<object_id>` identifier. */
type EntityId = z.output<typeof entityIdSchema>;
//#endregion
//#region ../contracts/dist/registration.d.ts
/**
 * How history should aggregate a numeric entity.
 *
 * `total_increasing` is the one that matters: energy consumed over a day is last minus first,
 * not a sum of averages, and only the integration knows which kind of counter it is reading.
 */
declare const ENTITY_STATE_CLASSES: readonly ["measurement", "total", "total_increasing"];
/** How history should aggregate a numeric entity. */
type EntityStateClass = (typeof ENTITY_STATE_CLASSES)[number];
/**
 * What an entity declares it can do, with the device's own limits for each.
 *
 * A partial record rather than a full one: an entity declares the capabilities it has, not every
 * capability that exists. Each capability's parameters are checked against that capability's own
 * schema, because `core` later validates commands against them - `color_temp` without its mired
 * range would be accepted here and then reject every `set_color_temp` for a reason the owner
 * cannot act on.
 */
declare const declaredCapabilitiesSchema: z.ZodRecord<z.ZodEnum<{
  number: "number";
  custom: "custom";
  image: "image";
  level: "level";
  select: "select";
  button: "button";
  sensor_numeric: "sensor_numeric";
  sensor_text: "sensor_text";
  sensor_binary: "sensor_binary";
  on_off: "on_off";
  color_hs: "color_hs";
  color_temp: "color_temp";
  cover: "cover";
  lock: "lock";
  thermostat: "thermostat";
  media_player: "media_player";
  camera: "camera";
  update: "update";
  lawn_mower: "lawn_mower";
  vacuum: "vacuum";
}> & z.core.$partial, z.ZodType<JsonObject, unknown, z.core.$ZodTypeInternals<JsonObject, unknown>>>;
/** What an entity declares it can do, with the device's own limits for each. */
type DeclaredCapabilities = z.output<typeof declaredCapabilitiesSchema>;
/**
 * What lets an entity be told apart from the same reading reached another way: its own key in its
 * transport's terms - `switch:0` on a Shelly - and where it sits in Matter.
 */
declare const entityLinkHintSchema: z.ZodObject<{
  key: z.ZodOptional<z.ZodString>;
  matter: z.ZodOptional<z.ZodObject<{
    endpoint: z.ZodInt;
    cluster: z.ZodInt;
    attribute: z.ZodInt;
  }, z.core.$strict>>;
}, z.core.$strict>;
/** What lets an entity be told apart from the same reading reached another way. */
type EntityLinkHint = z.output<typeof entityLinkHintSchema>;
//#endregion
//#region ../contracts/dist/entity-state.d.ts
/**
 * What an adapter publishes when a device reports.
 *
 * Deliberately smaller than {@link entityStateSchema}: an adapter reports what it observed, and
 * `core` is the single writer that decides `lastChanged`, resolves the context and persists the
 * result. An adapter that could set `lastChanged` itself would be a second writer of the
 * registry's most load-bearing field.
 */
declare const stateReportSchema: z.ZodObject<{
  entityId: z.core.$ZodBranded<z.ZodString, "EntityId", "out">;
  state: z.ZodObject<{
    on_off: z.ZodOptional<z.ZodObject<{
      isOn: z.ZodBoolean;
    }, z.core.$strip>>;
    level: z.ZodOptional<z.ZodObject<{
      level: z.ZodNumber;
    }, z.core.$strip>>;
    color_hs: z.ZodOptional<z.ZodObject<{
      hue: z.ZodNumber;
      saturation: z.ZodNumber;
    }, z.core.$strip>>;
    color_temp: z.ZodOptional<z.ZodObject<{
      mireds: z.ZodInt;
    }, z.core.$strip>>;
    cover: z.ZodOptional<z.ZodObject<{
      position: z.ZodNumber;
      tilt: z.ZodOptional<z.ZodNumber>;
      motion: z.ZodEnum<{
        opening: "opening";
        closing: "closing";
        stopped: "stopped";
      }>;
    }, z.core.$strip>>;
    lock: z.ZodOptional<z.ZodObject<{
      lockState: z.ZodEnum<{
        locked: "locked";
        unlocked: "unlocked";
        jammed: "jammed";
      }>;
    }, z.core.$strip>>;
    thermostat: z.ZodOptional<z.ZodObject<{
      currentTemperature: z.ZodNumber;
      targetTemperature: z.ZodNumber;
      mode: z.ZodEnum<{
        off: "off";
        heat: "heat";
        cool: "cool";
        auto: "auto";
        fan_only: "fan_only";
        dry: "dry";
      }>;
      action: z.ZodEnum<{
        off: "off";
        idle: "idle";
        heating: "heating";
        cooling: "cooling";
        drying: "drying";
        fan: "fan";
      }>;
      humidity: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strip>>;
    sensor_numeric: z.ZodOptional<z.ZodObject<{
      value: z.ZodNumber;
    }, z.core.$strip>>;
    sensor_binary: z.ZodOptional<z.ZodObject<{
      isOn: z.ZodBoolean;
    }, z.core.$strip>>;
    sensor_text: z.ZodOptional<z.ZodObject<{
      value: z.ZodString;
    }, z.core.$strip>>;
    media_player: z.ZodOptional<z.ZodObject<{
      playback: z.ZodEnum<{
        stopped: "stopped";
        idle: "idle";
        playing: "playing";
        paused: "paused";
        buffering: "buffering";
      }>;
      volume: z.ZodNumber;
      isMuted: z.ZodBoolean;
      source: z.ZodOptional<z.ZodString>;
      mediaTitle: z.ZodOptional<z.ZodString>;
      mediaArtist: z.ZodOptional<z.ZodString>;
      mediaDurationSeconds: z.ZodOptional<z.ZodNumber>;
      mediaPositionSeconds: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strip>>;
    camera: z.ZodOptional<z.ZodObject<{
      isStreamAvailable: z.ZodBoolean;
      snapshotPath: z.ZodOptional<z.ZodString>;
      isRecording: z.ZodDefault<z.ZodBoolean>;
    }, z.core.$strip>>;
    button: z.ZodOptional<z.ZodObject<{}, z.core.$strip>>;
    update: z.ZodOptional<z.ZodObject<{
      installedVersion: z.ZodDefault<z.ZodNullable<z.ZodString>>;
      latestVersion: z.ZodDefault<z.ZodNullable<z.ZodString>>;
      isInstalling: z.ZodDefault<z.ZodBoolean>;
      progress: z.ZodDefault<z.ZodNullable<z.ZodNumber>>;
    }, z.core.$strip>>;
    lawn_mower: z.ZodOptional<z.ZodObject<{
      activity: z.ZodEnum<{
        error: "error";
        idle: "idle";
        paused: "paused";
        mowing: "mowing";
        returning: "returning";
        docked: "docked";
      }>;
      isResumable: z.ZodDefault<z.ZodBoolean>;
    }, z.core.$strip>>;
    select: z.ZodOptional<z.ZodObject<{
      option: z.ZodDefault<z.ZodNullable<z.ZodString>>;
    }, z.core.$strip>>;
    number: z.ZodOptional<z.ZodObject<{
      value: z.ZodDefault<z.ZodNullable<z.ZodNumber>>;
    }, z.core.$strip>>;
    vacuum: z.ZodOptional<z.ZodObject<{
      activity: z.ZodEnum<{
        error: "error";
        idle: "idle";
        paused: "paused";
        returning: "returning";
        docked: "docked";
        cleaning: "cleaning";
      }>;
      rooms: z.ZodDefault<z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        name: z.ZodString;
      }, z.core.$strip>>>;
      isResumable: z.ZodDefault<z.ZodBoolean>;
    }, z.core.$strip>>;
    image: z.ZodOptional<z.ZodObject<{
      contentType: z.ZodEnum<{
        "image/svg+xml": "image/svg+xml";
        "image/png": "image/png";
        "image/jpeg": "image/jpeg";
      }>;
      revision: z.ZodString;
      width: z.ZodOptional<z.ZodInt>;
      height: z.ZodOptional<z.ZodInt>;
    }, z.core.$strip>>;
    custom: z.ZodOptional<z.ZodObject<{
      values: z.ZodRecord<z.ZodString, z.ZodUnion<readonly [z.ZodString, z.ZodNumber, z.ZodBoolean, z.ZodNull]>>;
    }, z.core.$strip>>;
  }, z.core.$strip>;
  attributes: z.ZodOptional<z.ZodType<JsonObject, unknown, z.core.$ZodTypeInternals<JsonObject, unknown>>>;
  isAvailable: z.ZodOptional<z.ZodBoolean>;
  observedAt: z.ZodOptional<z.ZodUnion<readonly [z.ZodDate, z.ZodPipe<z.ZodISODateTime, z.ZodTransform<Date, string>>]>>;
}, z.core.$strip>;
/** What an adapter publishes when a device reports. */
type StateReport = z.output<typeof stateReportSchema>;
//#endregion
//#region ../contracts/dist/integration-setup.d.ts
/** Validates one field of a group. */
declare const setupFieldSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
  type: z.ZodLiteral<"text">;
  placeholder: z.ZodOptional<z.ZodString>;
  pattern: z.ZodOptional<z.ZodString>;
  patternMessage: z.ZodOptional<z.ZodString>;
  minLength: z.ZodOptional<z.ZodInt>;
  maxLength: z.ZodDefault<z.ZodInt>;
  default: z.ZodOptional<z.ZodString>;
  key: z.ZodString;
  label: z.ZodString;
  help: z.ZodOptional<z.ZodString>;
  isRequired: z.ZodDefault<z.ZodBoolean>;
  shownWhen: z.ZodOptional<z.ZodObject<{
    key: z.ZodString;
    equals: z.ZodArray<z.ZodUnion<readonly [z.ZodString, z.ZodBoolean]>>;
  }, z.core.$strict>>;
  isLive: z.ZodOptional<z.ZodBoolean>;
}, z.core.$strict>, z.ZodObject<{
  type: z.ZodLiteral<"secret">;
  pattern: z.ZodOptional<z.ZodString>;
  patternMessage: z.ZodOptional<z.ZodString>;
  minLength: z.ZodOptional<z.ZodInt>;
  maxLength: z.ZodDefault<z.ZodInt>;
  key: z.ZodString;
  label: z.ZodString;
  help: z.ZodOptional<z.ZodString>;
  isRequired: z.ZodDefault<z.ZodBoolean>;
  shownWhen: z.ZodOptional<z.ZodObject<{
    key: z.ZodString;
    equals: z.ZodArray<z.ZodUnion<readonly [z.ZodString, z.ZodBoolean]>>;
  }, z.core.$strict>>;
  isLive: z.ZodOptional<z.ZodBoolean>;
}, z.core.$strict>, z.ZodObject<{
  type: z.ZodLiteral<"number">;
  min: z.ZodOptional<z.ZodNumber>;
  max: z.ZodOptional<z.ZodNumber>;
  isInteger: z.ZodDefault<z.ZodBoolean>;
  unit: z.ZodOptional<z.ZodString>;
  default: z.ZodOptional<z.ZodNumber>;
  warnBelow: z.ZodOptional<z.ZodNumber>;
  warning: z.ZodOptional<z.ZodString>;
  key: z.ZodString;
  label: z.ZodString;
  help: z.ZodOptional<z.ZodString>;
  isRequired: z.ZodDefault<z.ZodBoolean>;
  shownWhen: z.ZodOptional<z.ZodObject<{
    key: z.ZodString;
    equals: z.ZodArray<z.ZodUnion<readonly [z.ZodString, z.ZodBoolean]>>;
  }, z.core.$strict>>;
  isLive: z.ZodOptional<z.ZodBoolean>;
}, z.core.$strict>, z.ZodObject<{
  type: z.ZodLiteral<"boolean">;
  default: z.ZodOptional<z.ZodBoolean>;
  key: z.ZodString;
  label: z.ZodString;
  help: z.ZodOptional<z.ZodString>;
  isRequired: z.ZodDefault<z.ZodBoolean>;
  shownWhen: z.ZodOptional<z.ZodObject<{
    key: z.ZodString;
    equals: z.ZodArray<z.ZodUnion<readonly [z.ZodString, z.ZodBoolean]>>;
  }, z.core.$strict>>;
  isLive: z.ZodOptional<z.ZodBoolean>;
}, z.core.$strict>, z.ZodObject<{
  type: z.ZodLiteral<"choice">;
  choices: z.ZodArray<z.ZodObject<{
    value: z.ZodString;
    label: z.ZodString;
  }, z.core.$strict>>;
  default: z.ZodOptional<z.ZodString>;
  key: z.ZodString;
  label: z.ZodString;
  help: z.ZodOptional<z.ZodString>;
  isRequired: z.ZodDefault<z.ZodBoolean>;
  shownWhen: z.ZodOptional<z.ZodObject<{
    key: z.ZodString;
    equals: z.ZodArray<z.ZodUnion<readonly [z.ZodString, z.ZodBoolean]>>;
  }, z.core.$strict>>;
  isLive: z.ZodOptional<z.ZodBoolean>;
}, z.core.$strict>, z.ZodObject<{
  type: z.ZodLiteral<"list">;
  placeholder: z.ZodOptional<z.ZodString>;
  minItems: z.ZodDefault<z.ZodInt>;
  maxItems: z.ZodDefault<z.ZodInt>;
  pattern: z.ZodOptional<z.ZodString>;
  patternMessage: z.ZodOptional<z.ZodString>;
  key: z.ZodString;
  label: z.ZodString;
  help: z.ZodOptional<z.ZodString>;
  isRequired: z.ZodDefault<z.ZodBoolean>;
  shownWhen: z.ZodOptional<z.ZodObject<{
    key: z.ZodString;
    equals: z.ZodArray<z.ZodUnion<readonly [z.ZodString, z.ZodBoolean]>>;
  }, z.core.$strict>>;
  isLive: z.ZodOptional<z.ZodBoolean>;
}, z.core.$strict>], "type">;
/** One field of a group. */
type SetupField = z.output<typeof setupFieldSchema>;
/** Validates a whole `setup.json`. */
declare const integrationSetupSchema: z.ZodObject<{
  transport: z.ZodObject<{
    constants: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodUnion<readonly [z.ZodString, z.ZodNumber, z.ZodBoolean]>>>;
    fields: z.ZodDefault<z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
      type: z.ZodLiteral<"text">;
      placeholder: z.ZodOptional<z.ZodString>;
      pattern: z.ZodOptional<z.ZodString>;
      patternMessage: z.ZodOptional<z.ZodString>;
      minLength: z.ZodOptional<z.ZodInt>;
      maxLength: z.ZodDefault<z.ZodInt>;
      default: z.ZodOptional<z.ZodString>;
      key: z.ZodString;
      label: z.ZodString;
      help: z.ZodOptional<z.ZodString>;
      isRequired: z.ZodDefault<z.ZodBoolean>;
      shownWhen: z.ZodOptional<z.ZodObject<{
        key: z.ZodString;
        equals: z.ZodArray<z.ZodUnion<readonly [z.ZodString, z.ZodBoolean]>>;
      }, z.core.$strict>>;
      isLive: z.ZodOptional<z.ZodBoolean>;
    }, z.core.$strict>, z.ZodObject<{
      type: z.ZodLiteral<"secret">;
      pattern: z.ZodOptional<z.ZodString>;
      patternMessage: z.ZodOptional<z.ZodString>;
      minLength: z.ZodOptional<z.ZodInt>;
      maxLength: z.ZodDefault<z.ZodInt>;
      key: z.ZodString;
      label: z.ZodString;
      help: z.ZodOptional<z.ZodString>;
      isRequired: z.ZodDefault<z.ZodBoolean>;
      shownWhen: z.ZodOptional<z.ZodObject<{
        key: z.ZodString;
        equals: z.ZodArray<z.ZodUnion<readonly [z.ZodString, z.ZodBoolean]>>;
      }, z.core.$strict>>;
      isLive: z.ZodOptional<z.ZodBoolean>;
    }, z.core.$strict>, z.ZodObject<{
      type: z.ZodLiteral<"number">;
      min: z.ZodOptional<z.ZodNumber>;
      max: z.ZodOptional<z.ZodNumber>;
      isInteger: z.ZodDefault<z.ZodBoolean>;
      unit: z.ZodOptional<z.ZodString>;
      default: z.ZodOptional<z.ZodNumber>;
      warnBelow: z.ZodOptional<z.ZodNumber>;
      warning: z.ZodOptional<z.ZodString>;
      key: z.ZodString;
      label: z.ZodString;
      help: z.ZodOptional<z.ZodString>;
      isRequired: z.ZodDefault<z.ZodBoolean>;
      shownWhen: z.ZodOptional<z.ZodObject<{
        key: z.ZodString;
        equals: z.ZodArray<z.ZodUnion<readonly [z.ZodString, z.ZodBoolean]>>;
      }, z.core.$strict>>;
      isLive: z.ZodOptional<z.ZodBoolean>;
    }, z.core.$strict>, z.ZodObject<{
      type: z.ZodLiteral<"boolean">;
      default: z.ZodOptional<z.ZodBoolean>;
      key: z.ZodString;
      label: z.ZodString;
      help: z.ZodOptional<z.ZodString>;
      isRequired: z.ZodDefault<z.ZodBoolean>;
      shownWhen: z.ZodOptional<z.ZodObject<{
        key: z.ZodString;
        equals: z.ZodArray<z.ZodUnion<readonly [z.ZodString, z.ZodBoolean]>>;
      }, z.core.$strict>>;
      isLive: z.ZodOptional<z.ZodBoolean>;
    }, z.core.$strict>, z.ZodObject<{
      type: z.ZodLiteral<"choice">;
      choices: z.ZodArray<z.ZodObject<{
        value: z.ZodString;
        label: z.ZodString;
      }, z.core.$strict>>;
      default: z.ZodOptional<z.ZodString>;
      key: z.ZodString;
      label: z.ZodString;
      help: z.ZodOptional<z.ZodString>;
      isRequired: z.ZodDefault<z.ZodBoolean>;
      shownWhen: z.ZodOptional<z.ZodObject<{
        key: z.ZodString;
        equals: z.ZodArray<z.ZodUnion<readonly [z.ZodString, z.ZodBoolean]>>;
      }, z.core.$strict>>;
      isLive: z.ZodOptional<z.ZodBoolean>;
    }, z.core.$strict>, z.ZodObject<{
      type: z.ZodLiteral<"list">;
      placeholder: z.ZodOptional<z.ZodString>;
      minItems: z.ZodDefault<z.ZodInt>;
      maxItems: z.ZodDefault<z.ZodInt>;
      pattern: z.ZodOptional<z.ZodString>;
      patternMessage: z.ZodOptional<z.ZodString>;
      key: z.ZodString;
      label: z.ZodString;
      help: z.ZodOptional<z.ZodString>;
      isRequired: z.ZodDefault<z.ZodBoolean>;
      shownWhen: z.ZodOptional<z.ZodObject<{
        key: z.ZodString;
        equals: z.ZodArray<z.ZodUnion<readonly [z.ZodString, z.ZodBoolean]>>;
      }, z.core.$strict>>;
      isLive: z.ZodOptional<z.ZodBoolean>;
    }, z.core.$strict>], "type">>>;
  }, z.core.$strict>;
  options: z.ZodDefault<z.ZodObject<{
    constants: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodUnion<readonly [z.ZodString, z.ZodNumber, z.ZodBoolean]>>>;
    fields: z.ZodDefault<z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
      type: z.ZodLiteral<"text">;
      placeholder: z.ZodOptional<z.ZodString>;
      pattern: z.ZodOptional<z.ZodString>;
      patternMessage: z.ZodOptional<z.ZodString>;
      minLength: z.ZodOptional<z.ZodInt>;
      maxLength: z.ZodDefault<z.ZodInt>;
      default: z.ZodOptional<z.ZodString>;
      key: z.ZodString;
      label: z.ZodString;
      help: z.ZodOptional<z.ZodString>;
      isRequired: z.ZodDefault<z.ZodBoolean>;
      shownWhen: z.ZodOptional<z.ZodObject<{
        key: z.ZodString;
        equals: z.ZodArray<z.ZodUnion<readonly [z.ZodString, z.ZodBoolean]>>;
      }, z.core.$strict>>;
      isLive: z.ZodOptional<z.ZodBoolean>;
    }, z.core.$strict>, z.ZodObject<{
      type: z.ZodLiteral<"secret">;
      pattern: z.ZodOptional<z.ZodString>;
      patternMessage: z.ZodOptional<z.ZodString>;
      minLength: z.ZodOptional<z.ZodInt>;
      maxLength: z.ZodDefault<z.ZodInt>;
      key: z.ZodString;
      label: z.ZodString;
      help: z.ZodOptional<z.ZodString>;
      isRequired: z.ZodDefault<z.ZodBoolean>;
      shownWhen: z.ZodOptional<z.ZodObject<{
        key: z.ZodString;
        equals: z.ZodArray<z.ZodUnion<readonly [z.ZodString, z.ZodBoolean]>>;
      }, z.core.$strict>>;
      isLive: z.ZodOptional<z.ZodBoolean>;
    }, z.core.$strict>, z.ZodObject<{
      type: z.ZodLiteral<"number">;
      min: z.ZodOptional<z.ZodNumber>;
      max: z.ZodOptional<z.ZodNumber>;
      isInteger: z.ZodDefault<z.ZodBoolean>;
      unit: z.ZodOptional<z.ZodString>;
      default: z.ZodOptional<z.ZodNumber>;
      warnBelow: z.ZodOptional<z.ZodNumber>;
      warning: z.ZodOptional<z.ZodString>;
      key: z.ZodString;
      label: z.ZodString;
      help: z.ZodOptional<z.ZodString>;
      isRequired: z.ZodDefault<z.ZodBoolean>;
      shownWhen: z.ZodOptional<z.ZodObject<{
        key: z.ZodString;
        equals: z.ZodArray<z.ZodUnion<readonly [z.ZodString, z.ZodBoolean]>>;
      }, z.core.$strict>>;
      isLive: z.ZodOptional<z.ZodBoolean>;
    }, z.core.$strict>, z.ZodObject<{
      type: z.ZodLiteral<"boolean">;
      default: z.ZodOptional<z.ZodBoolean>;
      key: z.ZodString;
      label: z.ZodString;
      help: z.ZodOptional<z.ZodString>;
      isRequired: z.ZodDefault<z.ZodBoolean>;
      shownWhen: z.ZodOptional<z.ZodObject<{
        key: z.ZodString;
        equals: z.ZodArray<z.ZodUnion<readonly [z.ZodString, z.ZodBoolean]>>;
      }, z.core.$strict>>;
      isLive: z.ZodOptional<z.ZodBoolean>;
    }, z.core.$strict>, z.ZodObject<{
      type: z.ZodLiteral<"choice">;
      choices: z.ZodArray<z.ZodObject<{
        value: z.ZodString;
        label: z.ZodString;
      }, z.core.$strict>>;
      default: z.ZodOptional<z.ZodString>;
      key: z.ZodString;
      label: z.ZodString;
      help: z.ZodOptional<z.ZodString>;
      isRequired: z.ZodDefault<z.ZodBoolean>;
      shownWhen: z.ZodOptional<z.ZodObject<{
        key: z.ZodString;
        equals: z.ZodArray<z.ZodUnion<readonly [z.ZodString, z.ZodBoolean]>>;
      }, z.core.$strict>>;
      isLive: z.ZodOptional<z.ZodBoolean>;
    }, z.core.$strict>, z.ZodObject<{
      type: z.ZodLiteral<"list">;
      placeholder: z.ZodOptional<z.ZodString>;
      minItems: z.ZodDefault<z.ZodInt>;
      maxItems: z.ZodDefault<z.ZodInt>;
      pattern: z.ZodOptional<z.ZodString>;
      patternMessage: z.ZodOptional<z.ZodString>;
      key: z.ZodString;
      label: z.ZodString;
      help: z.ZodOptional<z.ZodString>;
      isRequired: z.ZodDefault<z.ZodBoolean>;
      shownWhen: z.ZodOptional<z.ZodObject<{
        key: z.ZodString;
        equals: z.ZodArray<z.ZodUnion<readonly [z.ZodString, z.ZodBoolean]>>;
      }, z.core.$strict>>;
      isLive: z.ZodOptional<z.ZodBoolean>;
    }, z.core.$strict>], "type">>>;
  }, z.core.$strict>>;
  polling: z.ZodOptional<z.ZodObject<{
    default: z.ZodInt;
    min: z.ZodDefault<z.ZodInt>;
    max: z.ZodDefault<z.ZodInt>;
    warnBelow: z.ZodOptional<z.ZodInt>;
  }, z.core.$strict>>;
}, z.core.$strict>;
/** A whole `setup.json`, parsed. */
type IntegrationSetup = z.output<typeof integrationSetupSchema>;
//#endregion
//#region ../contracts/dist/integrations.d.ts
/**
 * The wires the interface names on a vendor's card: what a person recognises on the box, whatever
 * transport of the platform's or of the vendor's own carries it. `udp` is a device's own protocol
 * over plain datagrams on the network (Govee's LAN API), `modbus` Modbus TCP, `matter` the
 * house's Matter fabric.
 */
declare const TRANSPORT_WIRES: readonly ["http", "mqtt", "ble", "zigbee", "udp", "modbus", "matter"];
/** A wire the interface names. */
type TransportWire = (typeof TRANSPORT_WIRES)[number];
/**
 * How the platform installed a vendor: the contents of the marker beside its builds,
 * `hub/integrations/<vendor>/.nebula-install.json`, which names the build `hub` loads.
 */
declare const integrationInstallSchema: z.ZodObject<{
  build: z.ZodString;
  version: z.ZodString;
  source: z.ZodEnum<{
    index: "index";
    local: "local";
  }>;
  artifactSha256: z.ZodString;
  installedAt: z.ZodISODateTime;
  installedBy: z.ZodNullable<z.ZodUUID>;
}, z.core.$strict>;
/** How the platform installed a vendor. */
type IntegrationInstall = z.output<typeof integrationInstallSchema>;
//#endregion
//#region ../contracts/dist/modbus.d.ts
/**
 * A template: the device's entities, each capability mapped to the register it is read from and
 * the command it is written with.
 *
 * Every rule that ties fields together is here, so the editor's blocks, its file and the hub
 * refuse the same templates with the same words.
 */
declare const modbusTemplateSchema: z.ZodObject<{
  name: z.ZodString;
  device: z.ZodDefault<z.ZodString>;
  port: z.ZodDefault<z.ZodInt>;
  unitId: z.ZodDefault<z.ZodInt>;
  wordOrder: z.ZodDefault<z.ZodEnum<{
    high: "high";
    low: "low";
  }>>;
  pollSeconds: z.ZodDefault<z.ZodInt>;
  entities: z.ZodArray<z.ZodObject<{
    id: z.ZodOptional<z.ZodString>;
    name: z.ZodString;
    domain: z.ZodEnum<{
      number: "number";
      sensor: "sensor";
      binary_sensor: "binary_sensor";
      switch: "switch";
      light: "light";
      select: "select";
      button: "button";
    }>;
    capabilities: z.ZodRecord<z.ZodEnum<{
      number: "number";
      level: "level";
      select: "select";
      button: "button";
      sensor_numeric: "sensor_numeric";
      sensor_text: "sensor_text";
      sensor_binary: "sensor_binary";
      on_off: "on_off";
    }> & z.core.$partial, z.ZodObject<{
      read: z.ZodOptional<z.ZodObject<{
        function: z.ZodUnion<readonly [z.ZodLiteral<1>, z.ZodLiteral<2>, z.ZodLiteral<3>, z.ZodLiteral<4>]>;
        address: z.ZodUnion<readonly [z.ZodInt, z.ZodString]>;
        type: z.ZodOptional<z.ZodEnum<{
          string: "string";
          u16: "u16";
          s16: "s16";
          u32: "u32";
          s32: "s32";
          f32: "f32";
        }>>;
        count: z.ZodOptional<z.ZodInt>;
        bit: z.ZodOptional<z.ZodInt>;
        scale: z.ZodOptional<z.ZodNumber>;
        unit: z.ZodOptional<z.ZodString>;
        options: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
      }, z.core.$strict>>;
      write: z.ZodOptional<z.ZodObject<{
        function: z.ZodUnion<readonly [z.ZodLiteral<5>, z.ZodLiteral<6>, z.ZodLiteral<15>, z.ZodLiteral<16>]>;
        address: z.ZodOptional<z.ZodUnion<readonly [z.ZodInt, z.ZodString]>>;
        on: z.ZodOptional<z.ZodUnion<readonly [z.ZodInt, z.ZodString]>>;
        off: z.ZodOptional<z.ZodUnion<readonly [z.ZodInt, z.ZodString]>>;
        min: z.ZodOptional<z.ZodNumber>;
        max: z.ZodOptional<z.ZodNumber>;
        step: z.ZodOptional<z.ZodNumber>;
        value: z.ZodOptional<z.ZodUnion<readonly [z.ZodInt, z.ZodString]>>;
      }, z.core.$strict>>;
    }, z.core.$strict>>;
  }, z.core.$strict>>;
}, z.core.$strict>;
/** A template, checked. */
type ModbusTemplate = z.output<typeof modbusTemplateSchema>;
//#endregion
//#region ../package-runtime/dist/transport.d.ts
/** What an integration asks a transport to do, expressed as data. */
type TransportRequest = {
  /** Which device, in whatever way this transport identifies one. */
  readonly deviceKey: string;
  /** The transport's own verb: `get` and `post` for HTTP, `publish` for MQTT. */
  readonly op: string;
  /** The verb's arguments, in the transport's own vocabulary. */
  readonly args: JsonObject;
};
/**
 * A standing interest an integration has in what a connection carries.
 *
 * No `deviceKey`: a subscription is usually broader than one device - a topic filter, a polling
 * schedule - and the transport reports which device a message came from when it arrives.
 */
type TransportSubscription = {
  readonly op: string;
  readonly args: JsonObject;
};
/** Something a connection delivered without being asked. */
type TransportInbound = {
  readonly connectionKey: string;
  readonly deviceKey: string;
  /** Raw, as it arrived. Making sense of it is the integration's job. */
  readonly payload: unknown;
};
/** Something a scan found, before any integration has claimed it. */
type Discovered = {
  readonly deviceKey: string;
  /**
   * What the scan saw.
   *
   * The blob an integration decides on and, if it claims the device, describes it from. Keeping
   * it raw is what lets `describe` be a pure function of it.
   */
  readonly payload: unknown;
};
/** Whether a connection is currently usable. */
type TransportStatus = 'up' | 'down';
/**
 * What a transport is given when it opens a connection.
 *
 * The transport **calls** these. It is the one holding the socket, so it is the one that knows
 * when something arrived and when the connection dropped; `hub` cannot poll for either.
 */
type TransportContext = {
  readonly logger: BundleLogger;
  /** Called for every message the connection delivered without being asked. */
  deliver: (message: TransportInbound) => void;
  /** Called when the connection comes up or goes down. */
  report: (status: TransportStatus) => void;
  /**
   * The account the connection is for, when its configuration names one
   * (`config.account`) of the transport's own vendor - the session to use, and how to keep a
   * renewed one or say the owner must sign in again. Absent otherwise.
   */
  readonly account?: AccountHandle;
};
/**
 * What a scan or a probe is handed beside its arguments - the account its
 * configuration names (`config.account`), as a connection is handed it. Absent otherwise.
 */
type TransportLookContext = {
  readonly account?: AccountHandle;
};
/** One live connection, shared by every instance whose configuration resolves to it. */
type TransportConnection = {
  /** What this connection is shared under. */
  readonly key: string;
  /**
   * Performs one request.
   *
   * @param request - What to do.
   * @param signal - Cancels the request.
   * @returns Whatever the device answered, raw.
   */
  send: (request: TransportRequest, signal: AbortSignal) => Promise<unknown>;
  /**
   * Replaces the set of standing subscriptions.
   *
   * Replaces rather than adds, so that `hub` can recompute the whole set when an instance is
   * added or removed and apply it without tracking what it asked for last time.
   *
   * @param subscriptions - Everything this connection should now carry.
   * @returns A promise that settles once the transport has applied them.
   */
  apply: (subscriptions: readonly TransportSubscription[]) => Promise<void>;
  /**
   * Closes the connection.
   *
   * @returns A promise that settles once it is closed.
   */
  close: () => Promise<void>;
};
/**
 * How a kind of connection is opened, scanned and spoken to.
 *
 * Configuration arrives as `unknown` because this is what a registry holds, and a registry holds
 * transports of every shape. Each one narrows its own with {@link defineTransport}, which is also
 * the single place the settings an owner typed are validated.
 *
 * The alternative - a generic `Transport<TConfig>` - does not survive being put in a collection:
 * a `Transport<HttpConfig>` is not a `Transport<JsonObject>`, because a function taking the
 * narrower type cannot stand in for one taking the wider. Erasing the parameter here and
 * restoring it in the helper keeps both ends honest without a cast anywhere.
 */
type Transport = {
  /** `http`, `mqtt`, `esphome`. */
  readonly id: string;
  /** Validates the connection settings an owner supplied. */
  readonly configSchema: z.ZodType;
  /**
   * What two configurations must agree on to share one connection.
   *
   * Derived from the configuration rather than declared, because the answer is the transport's:
   * two MQTT instances share a connection when the broker matches, two HTTP ones never do.
   *
   * @param config - The connection settings.
   * @returns The key this configuration's connection is shared under.
   */
  connectionKey: (config: unknown) => string;
  /**
   * Opens a connection.
   *
   * @param config - The connection settings.
   * @param context - Where inbound messages and status changes go.
   * @returns The connection, once it is usable.
   */
  connect: (config: unknown, context: TransportContext) => Promise<TransportConnection>;
  /**
   * Looks for devices this transport can reach.
   *
   * @param config - The connection settings.
   * @param scan - The integration's search terms, in this transport's vocabulary.
   * @param signal - Ends the scan.
   * @param context - The account the configuration names.
   * @returns Candidates as they are found, rather than a list once the scan is over: a scan of a
   * house takes long enough that the interface should be filling in while it runs.
   */
  scan: (config: unknown, scan: JsonObject, signal: AbortSignal, context?: TransportLookContext) => AsyncIterable<Discovered>;
  /**
   * Tries the settings against the world and lets go again.
   *
   * What "Test" in the interface does before an owner saves: open whatever the transport opens
   * - a broker session, a request to each address - then close it, keeping nothing. Resolves
   * with one sentence saying what worked, so the interface can show it; rejects with an error
   * whose message names what did not, in the transport's own words, because "Not authorized"
   * and "ECONNREFUSED" send an owner to different places.
   *
   * @param config - What the owner typed, complete and in the clear.
   * @param signal - Gives up: a host that never answers must not hold the form open.
   * @param context - The account the configuration names.
   */
  probe: (config: unknown, signal: AbortSignal, context?: TransportLookContext) => Promise<string>;
};
/** A transport as its author writes it, with its own configuration type. */
type TransportSpec<TConfig> = {
  readonly id: string;
  readonly configSchema: z.ZodType<TConfig>;
  connectionKey: (config: TConfig) => string;
  connect: (config: TConfig, context: TransportContext) => Promise<TransportConnection>;
  scan: (config: TConfig, scan: JsonObject, signal: AbortSignal, context?: TransportLookContext) => AsyncIterable<Discovered>;
  probe: (config: TConfig, signal: AbortSignal, context?: TransportLookContext) => Promise<string>;
};
/**
 * Turns a transport written against its own configuration into one a registry can hold.
 *
 * Validation happens here and only here. Everything above receives whatever an owner put in a
 * `jsonb` column and passes it straight through, so a wrong setting fails once, with the
 * transport's own message, instead of being parsed in every caller that happens to remember to.
 *
 * @param spec - The transport, written against the configuration it understands.
 * @returns The same transport, with its configuration parameter erased.
 */
declare function defineTransport<TConfig>(spec: TransportSpec<TConfig>): Transport;
//#endregion
//#region ../package-runtime/dist/integration.d.ts
/** A device an integration has recognised as its own. */
type Claim = {
  /** How the transport addresses it. */
  readonly deviceKey: string;
  /** How the integration identifies it, stable across restarts. */
  readonly externalId: string;
  /**
   * What the integration recognised it from, kept for {@link Integration.describe}.
   *
   * Raw. For zigbee2mqtt this is the `exposes` tree, for ESPHome the entity list, for Matter the
   * endpoint and cluster tree. All three are self-describing, which is exactly why `describe`
   * can be a pure function of this and why those integrations cover thousands of devices each.
   */
  readonly descriptor: unknown;
};
/** One entity a device exposes, before `hub` has given it an identifier. */
type EntityDescriptor = {
  readonly domain: EntityDomain;
  /** Distinguishes it from the device's other entities. Omitted when it is the only one. */
  readonly objectId?: string;
  readonly name: string;
  /** The catalogue icon it starts with, when the bundle names one. */
  readonly icon?: string;
  readonly capabilities: DeclaredCapabilities;
  readonly unitOfMeasurement?: string;
  readonly deviceClass?: string;
  readonly stateClass?: EntityStateClass;
  readonly displayPrecision?: number;
  /** What links it to the same reading reached another way. */
  readonly link?: EntityLinkHint;
};
/** What a claimed device turns out to be. */
type DeviceDescriptor = {
  readonly externalId: string;
  readonly name: string;
  readonly manufacturer?: string;
  readonly model?: string;
  readonly swVersion?: string;
  readonly hwVersion?: string;
  /** The hardware's MAC address, lower case with colons, when it says one. */
  readonly mac?: string;
  readonly serialNumber?: string;
  /**
   * The device this one is reached through, named the way this integration names devices.
   *
   * A BLE thermometer reached through an ESPHome proxy names the proxy here. It is what lets the
   * interface answer "why did six things go offline at once" with the one that actually did.
   */
  readonly viaExternalId?: string;
  readonly entities: readonly EntityDescriptor[];
};
/** What a mapper may look at besides its own arguments. */
type MappingContext = {
  /** The instance's own settings, already validated against the integration's schema. */
  readonly options: JsonObject;
  /** The device being mapped. */
  readonly claim: Claim;
  /** The entity identifiers `hub` gave this device, keyed by descriptor `objectId`. */
  readonly entities: ReadonlyMap<string, EntityId>;
  /**
   * The last state `hub` published for an entity.
   *
   * Present so that a command needing the current value can be built without asking the device.
   * Undefined before the entity has ever reported.
   *
   * @param entityId - The entity to look up.
   * @returns Its last known state, or undefined.
   */
  lastState: (entityId: EntityId) => CapabilityState | undefined;
};
/** A command, resolved to the device and entity it is for. */
type CommandTarget = {
  readonly entityId: EntityId;
  readonly capability: CapabilityName;
  /** Already validated by `core` against the capability's command schema. */
  readonly command: JsonObject;
};
/**
 * The picture an image entity's report carries beside its state - an SVG, a PNG - which
 * the hub keeps and never publishes: the state says which picture it is (`revision`), and the
 * bytes are asked for by whoever shows it.
 */
type ImageBlob = {
  readonly contentType: 'image/svg+xml' | 'image/png' | 'image/jpeg';
  /** The picture: an SVG's text, or bytes. */
  readonly data: string | Buffer;
  /** How often at most a new picture of the entity is announced; 2 s unless said. */
  readonly minIntervalMs?: number;
};
/** A report as an integration makes it: the state, and the picture of an image entity. */
type ReportedState = StateReport & {
  readonly blob?: ImageBlob;
};
/** What a kind of device means, in terms of the canonical model. */
type Integration<TOptions = JsonObject> = {
  /** The bundle kind: `zigbee2mqtt`, `shelly-gen2`. An instance of it gets its own id. */
  readonly id: string;
  /** Which transport carries it. */
  readonly transport: string;
  /** Validates the settings an owner supplied for an instance. */
  readonly optionsSchema: z.ZodType<TOptions>;
  /**
   * What to tell the transport to look for during a scan.
   *
   * The transport's own vocabulary - an mDNS service name, an MQTT topic filter - and opaque
   * here. An empty object means "whatever you would find anyway", which is what a code
   * integration on a transport that enumerates broadly uses.
   */
  readonly discovery: JsonObject;
  /**
   * Decides whether a discovered device is this integration's to own.
   *
   * @param discovered - What the scan found.
   * @param options - The instance's settings.
   * @returns The claim, or null when the device belongs to someone else.
   */
  claim: (discovered: Discovered, options: TOptions) => Claim | null;
  /**
   * States what the transport must carry for these devices.
   *
   * Data rather than an action: `hub` collects the answers from every instance sharing a
   * connection, deduplicates them, and applies the set once.
   *
   * @param claims - The devices this instance owns.
   * @param options - The instance's settings.
   * @returns Everything the transport should subscribe to or poll.
   */
  subscriptions: (claims: readonly Claim[], options: TOptions) => TransportSubscription[];
  /**
   * Says what a claimed device is and what it exposes.
   *
   * @param claim - The device.
   * @param options - The instance's settings.
   * @returns Its identity and its entities.
   */
  describe: (claim: Claim, options: TOptions) => DeviceDescriptor;
  /**
   * Turns something the device sent into canonical state.
   *
   * @param message - What arrived.
   * @param context - The claim, the settings and the last known state.
   * @returns One report per entity the message says something about, which may be none.
   */
  toState: (message: TransportInbound, context: MappingContext) => ReportedState[];
  /**
   * Turns a canonical command into something the transport can perform.
   *
   * @param target - The entity, the capability and the command.
   * @param context - The claim, the settings and the last known state.
   * @returns The request. Performing it is the transport's job.
   */
  toCommand: (target: CommandTarget, context: MappingContext) => TransportRequest;
  /**
   * Reads what a message says about the device itself, beyond its entities: the firmware it runs
   * now, which changes when it is updated and is otherwise only known from when it was found.
   *
   * Optional: an integration whose messages say nothing of the kind leaves it out.
   *
   * @param message - What arrived.
   * @param context - The claim, the settings and the last known state.
   * @returns What the message says, field by field; undefined, or a field left out, when it says
   * nothing about it.
   */
  deviceInfo?: (message: TransportInbound, context: MappingContext) => DeviceInfo | undefined;
  /**
   * Says how a camera entity's picture is read, when it is one.
   *
   * Optional: an integration with no camera leaves it out.
   *
   * @param entityId - The entity.
   * @param context - The claim, the settings and the last known state.
   * @returns The stream source and what it is told to read, or undefined for an entity with none.
   */
  streamOf?: (entityId: EntityId, context: MappingContext) => StreamRequest | undefined;
};
/** How one camera's picture is read: which source, told what. */
type StreamRequest = {
  readonly source: string;
  readonly args: JsonObject;
};
/** What a message says about the device itself. */
type DeviceInfo = {
  readonly swVersion?: string;
  readonly hwVersion?: string;
};
//#endregion
//#region ../package-runtime/dist/stream.d.ts
/** What a stream carries: stills, or H.264 with the codec string its decoder is set up with. */
type StreamTrack = {
  readonly kind: 'jpeg';
} | {
  readonly kind: 'h264';
  readonly codec: string;
};
/** One frame of a stream. */
type StreamFrame = {
  /** A JPEG, or an H.264 access unit in Annex B with its parameter sets before a key frame. */
  readonly data: Uint8Array;
  /** Whether a decoder can start from it. */
  readonly isKey: boolean;
  /** When it was taken, in microseconds from the start of the stream. */
  readonly timestampUs: number;
};
/** Where a source puts what it reads. */
type StreamSink = {
  /** Says what the stream carries; called once, before the first frame. */
  describe: (track: StreamTrack) => void;
  /** Hands over one frame. */
  frame: (frame: StreamFrame) => void;
};
/** How a camera's picture is read. */
type StreamSource = {
  /** `<vendor>/<name>`, as the profile names it. */
  readonly id: string;
  /** Validates the settings it reads the camera with: the instance's transport settings. */
  readonly configSchema: z.ZodType;
  /**
   * Reads the stream until the signal ends it or the camera does.
   *
   * @param config - The instance's transport settings, secrets opened.
   * @param args - What the profile's camera entity says to read.
   * @param sink - Where the track and the frames go.
   * @param signal - Ends the stream.
   * @returns A promise that settles when the stream ended; rejects with why, when it failed.
   */
  open: (config: unknown, args: JsonObject, sink: StreamSink, signal: AbortSignal) => Promise<void>;
};
/** A stream source as its author writes it, with its own configuration type. */
type StreamSourceSpec<TConfig> = {
  readonly id: string;
  readonly configSchema: z.ZodType<TConfig>;
  open: (config: TConfig, args: JsonObject, sink: StreamSink, signal: AbortSignal) => Promise<void>;
};
/**
 * Turns a stream source written against its own configuration into one a registry can hold,
 * validating the settings on the way in as {@link defineTransport} does.
 *
 * @param spec - The source.
 * @returns The same source, its configuration parameter erased.
 */
declare function defineStreamSource<TConfig>(spec: StreamSourceSpec<TConfig>): StreamSource;
/** One access unit an RTSP session delivered. */
type RtspFrame = StreamFrame & {
  /** The codec string of the stream, from its sequence parameters. */
  readonly codec: string;
};
/** What opening an RTSP session takes. */
type RtspOptions = {
  /** `rtsp://user:password@host:port/path`, or `rtsps://` over TLS. */
  readonly url: string;
  /** Whether a TLS camera's certificate must chain to an authority this machine trusts. */
  readonly rejectUnauthorized?: boolean;
  /** Ends the session. */
  readonly signal: AbortSignal;
};
/**
 * Plays an RTSP stream over TCP and yields its H.264 access units.
 *
 * @throws {Error} From the iteration, when the camera refused or the session failed.
 */
type OpenRtsp = (options: RtspOptions) => AsyncIterable<RtspFrame>;
//#endregion
//#region ../package-runtime/dist/sdk.d.ts
/**
 * One level of a bundle's log: fields and a message, or a message alone - pino's way, which is the
 * logger `hub` hands over.
 */
type BundleLogFn = {
  (fields: object, message?: string): void;
  (message: string): void;
};
/**
 * The hub's logger, as far as a bundle's code may use it: named here rather than as the platform's
 * logger type, so that what a bundle is written against says nothing of how the platform logs.
 */
type BundleLogger = {
  readonly trace: BundleLogFn;
  readonly debug: BundleLogFn;
  readonly info: BundleLogFn;
  readonly warn: BundleLogFn;
  readonly error: BundleLogFn;
  readonly fatal: BundleLogFn;
  /**
   * A logger whose every line carries these fields too.
   *
   * @param fields - The fields.
   * @returns The logger.
   */
  child: (fields: Record<string, unknown>) => BundleLogger;
};
/** HTTP headers for a WebSocket's opening handshake. */
type ManagedSocketHeaders = Readonly<Record<string, string>>;
/** What a drop says beyond its reason. */
type ManagedSocketClose = {
  /** The WebSocket close code: the peer's, or 1006 for a socket that ended without one. */
  readonly code?: number;
  /**
   * The HTTP status of a handshake the server refused - 401, 403 - so that credentials it turned
   * down can be told from a network that failed. Absent for any other drop.
   */
  readonly status?: number;
};
/** What opening a managed WebSocket takes. */
type ManagedSocketOptions = {
  /** `ws://host/path` or `wss://…`. */
  readonly url: string;
  /**
   * Headers sent on the opening handshake, the first and every reconnect's, for a
   * server that authenticates the socket by them. Never logged. A function is called before each
   * attempt and may answer with a promise - for a token that expires; one that throws fails that
   * attempt as a refused connection would, and the next comes on the usual schedule.
   */
  readonly headers?: ManagedSocketHeaders | (() => ManagedSocketHeaders | Promise<ManagedSocketHeaders>);
  /**
   * A ping every `everyMs`, and the socket dropped - then reconnected - when no pong
   * comes within `timeoutMs`. For a peer that may say nothing for hours, whose silence would
   * otherwise hide a dead connection. Off unless said.
   */
  readonly ping?: {
    readonly everyMs: number;
    readonly timeoutMs: number;
  };
  /**
   * TLS for a `wss://` server: whether its certificate must chain to an authority
   * this machine trusts (on unless said).
   */
  readonly tls?: {
    readonly rejectUnauthorized?: boolean;
  };
  readonly logger: BundleLogger;
  /** Called after every connection, the first and each one after a drop. */
  readonly onOpen: () => void;
  /** Called with each text frame. */
  readonly onMessage: (text: string) => void;
  /**
   * Called when the socket dropped or failed to connect; the helper reconnects by itself unless
   * the socket is closed here. The hub also says the close code and, for a handshake
   * the server refused, its HTTP status.
   */
  readonly onClose: (reason: string, details?: ManagedSocketClose) => void;
  /**
   * How to come back after a drop: doubling from `minMs` (1 s) to `maxMs` (30 s), reset by a
   * connection that opens. `false` is one attempt and no more, for a probe or a scan.
   */
  readonly reconnect?: {
    readonly minMs?: number;
    readonly maxMs?: number;
  } | false;
};
/** A WebSocket the hub keeps open on a bundle's behalf. */
type ManagedSocket = {
  /** Whether a frame can be sent right now. */
  readonly isOpen: boolean;
  /**
   * Sends one text frame.
   *
   * @throws {Error} When the socket is not open.
   */
  send: (text: string) => void;
  /** Drops the socket so the helper reconnects - after a request that timed out. */
  reset: (reason: string) => void;
  /** Closes for good. */
  close: () => Promise<void>;
};
/** Opens a managed WebSocket. */
type OpenWebSocket = (options: ManagedSocketOptions) => ManagedSocket;
/** Where a datagram came from. */
type UdpPeer = {
  readonly address: string;
  readonly port: number;
};
/** What opening a managed UDP socket takes. */
type ManagedUdpSocketOptions = {
  /** The port to listen on; absent, whatever port the system picks. */
  readonly port?: number;
  /** Whether another socket may bind the same port, as a multicast listener must allow. */
  readonly reuseAddr?: boolean;
  /** A multicast group to join, and whether to hear what this host itself sends to it. */
  readonly multicast?: {
    readonly group: string;
    readonly loopback?: boolean;
  };
  /** Whether the socket may send to a broadcast address. */
  readonly broadcast?: boolean;
  /** Called with each datagram, as bytes: some protocols are text and some are not. */
  readonly onMessage: (message: Buffer, from: UdpPeer) => void;
  /** Called when the socket fails after it opened. The hub has logged it already. */
  readonly onError?: (error: Error) => void;
};
/** A UDP socket the hub holds on a bundle's behalf. */
type ManagedUdpSocket = {
  /** The port it is bound to, known once it has opened. */
  readonly port: number;
  /**
   * Sends one datagram.
   *
   * @throws {Error} When the socket is closed or the send fails.
   */
  send: (message: Buffer | string, port: number, address: string) => Promise<void>;
  /** Closes for good, leaving the group. */
  close: () => Promise<void>;
};
/** Opens a managed UDP socket. */
type OpenUdpSocket = (options: ManagedUdpSocketOptions) => ManagedUdpSocket;
/** What opening a managed MQTT session takes. */
type ManagedMqttOptions = {
  /** `mqtt://host:1883`, or `mqtts://host:8883` behind TLS. */
  readonly url: string;
  /** The client id to connect as; one the client makes up when absent. */
  readonly clientId?: string;
  readonly username?: string;
  readonly password?: string;
  /**
   * TLS for an `mqtts://` broker: a client certificate as a PKCS#12 bundle and its passphrase,
   * for a broker that authenticates the client by certificate, and whether the broker's own
   * certificate must chain to an authority this machine trusts (on unless said).
   */
  readonly tls?: {
    readonly pfx?: Buffer;
    readonly passphrase?: string;
    readonly rejectUnauthorized?: boolean;
  };
  readonly logger: BundleLogger;
  /** Called after every connection, the first and each one after a drop. */
  readonly onConnect?: () => void;
  /** Called with each message on a topic subscribed to. */
  readonly onMessage: (topic: string, payload: Buffer) => void;
  /** Called when the session dropped or failed to come up; the helper reconnects by itself. */
  readonly onClose?: (reason: string) => void;
};
/** An MQTT session the hub keeps up on a bundle's behalf. */
type ManagedMqtt = {
  /** Whether a message can be published right now. */
  readonly isConnected: boolean;
  /** Subscribes, now and after every reconnect, until unsubscribed. */
  subscribe: (topic: string) => void;
  /** Stops hearing a topic. */
  unsubscribe: (topic: string) => void;
  /**
   * Publishes one message, at most once.
   *
   * @throws {Error} When the session is not up.
   */
  publish: (topic: string, payload: string | Buffer) => Promise<void>;
  /** Closes for good. */
  close: () => Promise<void>;
};
/** Opens a managed MQTT session. */
type OpenMqtt = (options: ManagedMqttOptions) => ManagedMqtt;
/** A Modbus server, as a session to it is opened: where it is, and how frames travel. */
type ModbusServerOptions = {
  readonly host: string;
  /** 502 unless said. */
  readonly port?: number;
  /** `tcp` (MBAP) unless said; `rtu` for RTU frames a transparent adapter carries over TCP. */
  readonly framing?: 'tcp' | 'rtu';
};
/** One read: a run of coils, inputs or registers of one unit. */
type ModbusReadOptions = {
  readonly unitId: number;
  readonly function: 1 | 2 | 3 | 4;
  readonly address: number;
  /** How many bits or registers, 1 to 125. */
  readonly count: number;
  /** How long to wait for the answer; 3 s unless said. */
  readonly timeoutMs?: number;
};
/** One write: a coil, a register, coils or registers of one unit. */
type ModbusWriteOptions = {
  readonly unitId: number;
  readonly function: 5 | 6 | 15 | 16;
  readonly address: number;
  /** The word for 05 (0xFF00 on, 0 off) and 06; the bits for 15; the registers for 16. */
  readonly values: readonly number[];
  readonly timeoutMs?: number;
};
/**
 * A session to a Modbus server through the hub's one connection to it: requests of every
 * session to the same server wait their turn, so a gateway that answers one client at a time is
 * never asked twice at once.
 *
 * A failed request rejects with an error whose `name` says why: `ModbusException` - the server
 * refused, its `code` the exception - `ModbusNoConnection` or `ModbusSilence`.
 */
type ModbusSession = {
  /**
   * Reads bits or registers.
   *
   * @returns One number per bit (0 or 1) or register (a 16-bit word).
   */
  read: (options: ModbusReadOptions, signal?: AbortSignal) => Promise<number[]>;
  /** Writes a coil, a register, coils or registers. */
  write: (options: ModbusWriteOptions, signal?: AbortSignal) => Promise<void>;
  /** Lets go of the server; the connection closes once nothing else holds it. */
  close: () => Promise<void>;
};
/** Opens a session to a Modbus server. */
type OpenModbus = (server: ModbusServerOptions) => ModbusSession;
/**
 * The house's MQTT broker, as the hub reaches it: the one the hub runs, with the hub's own
 * username - or the broker `NEBULA_MQTT_URL` names. Read again each time it is needed: a session
 * opened while the broker is still coming up retries until it listens.
 */
type PlatformMqtt = {
  readonly url: string;
  readonly username?: string;
  readonly password?: string;
};
/** What the platform offers a bundle beyond the pieces to build a transport from. */
type PlatformServices = {
  /**
   * The house's broker, for a vendor whose devices report through it - zigbee2mqtt - and which
   * runs its own program beside the platform. Null only while the hub cannot run one.
   */
  readonly mqtt: PlatformMqtt | null;
};
/** One colour of a palette: red, green, blue and, optionally, how opaque, each 0 to 255. */
type PaletteColour = readonly [number, number, number] | readonly [number, number, number, number];
/** A picture of a few colours: a robot's map, one palette index per cell. */
type PalettedPicture = {
  readonly width: number;
  readonly height: number;
  /** At most 256 colours. */
  readonly palette: readonly PaletteColour[];
  /** One index into the palette per pixel, row after row from the top left. */
  readonly pixels: Uint8Array;
};
/** What a bundle drawing a picture needs, and could not bring as a dependency. */
type BundleCodecs = {
  /**
   * Unpacks an LZMA stream in the alone format (`.lzma`): a 13-byte header - the properties and
   * the size, eight bytes of ones when unknown - then the stream. ECOVACS packs its maps so.
   *
   * @throws {Error} When the stream is corrupt.
   */
  readonly lzma: (bytes: Uint8Array) => Buffer;
};
/** Pictures a bundle draws, for an image entity. */
type BundleImages = {
  /**
   * Encodes a paletted picture as a PNG, a colour with an alpha below 255 transparent.
   *
   * @throws {Error} When the size, the palette and the pixels do not fit together.
   */
  readonly png: (picture: PalettedPicture) => Buffer;
};
/** What the hub hands a bundle's transport factory. */
type BundleSdk = {
  /** The runtime version, the same string `manifest.sdk` was matched against. */
  readonly version: string;
  /** The runtime's zod, so a bundle's schemas validate under the one instance the hub uses. */
  readonly z: typeof z;
  /** The hub's logger, for what happens outside a connection: a probe, a scan. */
  readonly logger: BundleLogger;
  readonly defineTransport: typeof defineTransport;
  readonly openWebSocket: OpenWebSocket;
  readonly openUdpSocket: OpenUdpSocket;
  /** An MQTT session, for a vendor whose devices report through a broker of its own. */
  readonly openMqtt: OpenMqtt;
  /** A session to a Modbus server, through the hub's one connection to it. */
  readonly openModbus: OpenModbus;
  /** How a camera's stream source is written, as defineTransport is for a transport. */
  readonly defineStreamSource: typeof defineStreamSource;
  /** An RTSP session over TCP, yielding a camera's H.264 as it comes. */
  readonly openRtsp: OpenRtsp;
  /** What the platform itself runs that a bundle may use - its MQTT broker. */
  readonly platform: PlatformServices;
  /** How an account's sign-in module is written, as defineTransport is for a transport. */
  readonly defineAccount: typeof defineAccount;
  /** Unpacking what a vendor's cloud packs. */
  readonly codecs: BundleCodecs;
  /** Drawing pictures, for an image entity. */
  readonly images: BundleImages;
};
//#endregion
//#region ../package-runtime/dist/account.d.ts
/** The contents of `account.json`. */
declare const accountDeclarationSchema: z.ZodObject<{
  name: z.ZodString;
  help: z.ZodOptional<z.ZodString>;
  fields: z.ZodObject<{
    constants: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodUnion<readonly [z.ZodString, z.ZodNumber, z.ZodBoolean]>>>;
    fields: z.ZodDefault<z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
      type: z.ZodLiteral<"text">;
      placeholder: z.ZodOptional<z.ZodString>;
      pattern: z.ZodOptional<z.ZodString>;
      patternMessage: z.ZodOptional<z.ZodString>;
      minLength: z.ZodOptional<z.ZodInt>;
      maxLength: z.ZodDefault<z.ZodInt>;
      default: z.ZodOptional<z.ZodString>;
      key: z.ZodString;
      label: z.ZodString;
      help: z.ZodOptional<z.ZodString>;
      isRequired: z.ZodDefault<z.ZodBoolean>;
      shownWhen: z.ZodOptional<z.ZodObject<{
        key: z.ZodString;
        equals: z.ZodArray<z.ZodUnion<readonly [z.ZodString, z.ZodBoolean]>>;
      }, z.core.$strict>>;
      isLive: z.ZodOptional<z.ZodBoolean>;
    }, z.core.$strict>, z.ZodObject<{
      type: z.ZodLiteral<"secret">;
      pattern: z.ZodOptional<z.ZodString>;
      patternMessage: z.ZodOptional<z.ZodString>;
      minLength: z.ZodOptional<z.ZodInt>;
      maxLength: z.ZodDefault<z.ZodInt>;
      key: z.ZodString;
      label: z.ZodString;
      help: z.ZodOptional<z.ZodString>;
      isRequired: z.ZodDefault<z.ZodBoolean>;
      shownWhen: z.ZodOptional<z.ZodObject<{
        key: z.ZodString;
        equals: z.ZodArray<z.ZodUnion<readonly [z.ZodString, z.ZodBoolean]>>;
      }, z.core.$strict>>;
      isLive: z.ZodOptional<z.ZodBoolean>;
    }, z.core.$strict>, z.ZodObject<{
      type: z.ZodLiteral<"number">;
      min: z.ZodOptional<z.ZodNumber>;
      max: z.ZodOptional<z.ZodNumber>;
      isInteger: z.ZodDefault<z.ZodBoolean>;
      unit: z.ZodOptional<z.ZodString>;
      default: z.ZodOptional<z.ZodNumber>;
      warnBelow: z.ZodOptional<z.ZodNumber>;
      warning: z.ZodOptional<z.ZodString>;
      key: z.ZodString;
      label: z.ZodString;
      help: z.ZodOptional<z.ZodString>;
      isRequired: z.ZodDefault<z.ZodBoolean>;
      shownWhen: z.ZodOptional<z.ZodObject<{
        key: z.ZodString;
        equals: z.ZodArray<z.ZodUnion<readonly [z.ZodString, z.ZodBoolean]>>;
      }, z.core.$strict>>;
      isLive: z.ZodOptional<z.ZodBoolean>;
    }, z.core.$strict>, z.ZodObject<{
      type: z.ZodLiteral<"boolean">;
      default: z.ZodOptional<z.ZodBoolean>;
      key: z.ZodString;
      label: z.ZodString;
      help: z.ZodOptional<z.ZodString>;
      isRequired: z.ZodDefault<z.ZodBoolean>;
      shownWhen: z.ZodOptional<z.ZodObject<{
        key: z.ZodString;
        equals: z.ZodArray<z.ZodUnion<readonly [z.ZodString, z.ZodBoolean]>>;
      }, z.core.$strict>>;
      isLive: z.ZodOptional<z.ZodBoolean>;
    }, z.core.$strict>, z.ZodObject<{
      type: z.ZodLiteral<"choice">;
      choices: z.ZodArray<z.ZodObject<{
        value: z.ZodString;
        label: z.ZodString;
      }, z.core.$strict>>;
      default: z.ZodOptional<z.ZodString>;
      key: z.ZodString;
      label: z.ZodString;
      help: z.ZodOptional<z.ZodString>;
      isRequired: z.ZodDefault<z.ZodBoolean>;
      shownWhen: z.ZodOptional<z.ZodObject<{
        key: z.ZodString;
        equals: z.ZodArray<z.ZodUnion<readonly [z.ZodString, z.ZodBoolean]>>;
      }, z.core.$strict>>;
      isLive: z.ZodOptional<z.ZodBoolean>;
    }, z.core.$strict>, z.ZodObject<{
      type: z.ZodLiteral<"list">;
      placeholder: z.ZodOptional<z.ZodString>;
      minItems: z.ZodDefault<z.ZodInt>;
      maxItems: z.ZodDefault<z.ZodInt>;
      pattern: z.ZodOptional<z.ZodString>;
      patternMessage: z.ZodOptional<z.ZodString>;
      key: z.ZodString;
      label: z.ZodString;
      help: z.ZodOptional<z.ZodString>;
      isRequired: z.ZodDefault<z.ZodBoolean>;
      shownWhen: z.ZodOptional<z.ZodObject<{
        key: z.ZodString;
        equals: z.ZodArray<z.ZodUnion<readonly [z.ZodString, z.ZodBoolean]>>;
      }, z.core.$strict>>;
      isLive: z.ZodOptional<z.ZodBoolean>;
    }, z.core.$strict>], "type">>>;
  }, z.core.$strict>;
  identity: z.ZodString;
  module: z.ZodString;
}, z.core.$strict>;
/** The contents of `account.json`. */
type AccountDeclaration = z.output<typeof accountDeclarationSchema>;
/** Who an account signed in as: the cloud's id for it, and what its card calls it. */
type AccountIdentity = {
  /** Stable across sign-ins: the account's id at the cloud. What a device remembers. */
  readonly id: string;
  /** What its card calls it: the email it was made with. */
  readonly label: string;
};
/** Where a sign-in stands, as the module answers it. */
type AccountModuleStep =
/** Done: who it is, and what to keep - tokens, a user id - for the next start. */
{
  readonly kind: 'connected';
  readonly identity: AccountIdentity;
  readonly session: JsonObject;
} |
/**
 * The cloud wants something more - a code it emailed, a second factor. `pending` is whatever
 * the module needs to carry on; it comes back with the answers.
 */
{
  readonly kind: 'ask';
  readonly message: string;
  readonly fields: readonly SetupField[];
  readonly pending: JsonObject;
} |
/** The owner approves on a page of the cloud's; asked again every `pollMs`. */
{
  readonly kind: 'link';
  readonly message: string;
  readonly url: string;
  readonly code?: string;
  readonly pollMs: number;
  readonly pending: JsonObject;
} |
/** It did not work, and why; `field` is the one to correct, when one is to blame. */
{
  readonly kind: 'failed';
  readonly message: string;
  readonly field?: string;
};
/** What a sign-in step is handed beside its arguments. */
type AccountStepContext = {
  /** Ends the step: the owner gave up, or it took too long. */
  readonly signal: AbortSignal;
};
/** What signing in to a vendor's account does, as its module writes it. */
type AccountModule = {
  /**
   * Signs in with what the owner typed, secrets opened.
   *
   * @returns Where it stands.
   */
  readonly signIn: (values: JsonObject, context: AccountStepContext) => Promise<AccountModuleStep>;
  /**
   * Carries on after a question, with its answers.
   *
   * @returns Where it stands now; the same question again, with why, for a wrong answer.
   */
  readonly answer: (pending: JsonObject, answers: JsonObject, context: AccountStepContext) => Promise<AccountModuleStep>;
  /**
   * Asks whether the page the owner was sent to was approved.
   *
   * @returns `link` again while it was not.
   */
  readonly poll?: (pending: JsonObject, context: AccountStepContext) => Promise<AccountModuleStep>;
  /**
   * Tells the cloud the account is forgotten, when the cloud has a way to: a token revoked.
   * Failing is not refusing - the account is forgotten here all the same.
   */
  readonly signOut?: (session: JsonObject, context: AccountStepContext) => Promise<void>;
};
/**
 * Declares what signing in to a vendor's account does. The identity function, as
 * `defineTransport` is: what it adds is the type, for a module written in JavaScript.
 *
 * @param module - The steps.
 * @returns The same steps.
 */
declare function defineAccount(module: AccountModule): AccountModule;
/**
 * One account signed in to, as a vendor's transport and listener are handed it.
 *
 * `credentials` are what the owner typed, secrets opened - for a module that signs in again with
 * the password when the session expired; `session` is what the last sign-in kept. A transport
 * that finds the session refused signs in again and keeps the new one (`update`); one that cannot
 * - the cloud wants the owner again - says so (`needsSignIn`), and the account's card asks.
 */
type AccountHandle = {
  readonly id: string;
  readonly label: string;
  readonly status: 'connected' | 'needs-sign-in' | 'failed';
  readonly credentials: JsonObject;
  readonly session: JsonObject;
  /**
   * Keeps a new session - tokens renewed - for this run and the next.
   *
   * @returns Once it is stored.
   */
  readonly update: (session: JsonObject) => Promise<void>;
  /**
   * Says the account needs the owner to sign in again, and why; its devices stop until then.
   *
   * @returns Once it is recorded.
   */
  readonly needsSignIn: (message: string) => Promise<void>;
};
//#endregion
//#region ../package-runtime/dist/bundle.d.ts
/**
 * The contents of `manifest.json`: what a vendor says about itself.
 *
 * Nothing here is about how a device is reached. Which transports the vendor speaks is
 * derived from its drivers when the bundle is loaded rather than declared, because a declared
 * `hasMqtt` is a second statement of a fact the drivers already make, and one that can be wrong.
 */
declare const vendorManifestSchema: z.ZodObject<{
  id: z.ZodString;
  version: z.ZodString;
  sdk: z.ZodString;
  name: z.ZodString;
  description: z.ZodOptional<z.ZodString>;
  url: z.ZodOptional<z.ZodURL>;
  color: z.ZodOptional<z.ZodString>;
  logo: z.ZodOptional<z.ZodPipe<z.ZodUnion<readonly [z.ZodString, z.ZodObject<{
    path: z.ZodString;
    padding: z.ZodDefault<z.ZodInt>;
  }, z.core.$strict>]>, z.ZodTransform<{
    path: string;
    padding: number;
  }, string | {
    path: string;
    padding: number;
  }>>>;
  internetRequired: z.ZodDefault<z.ZodBoolean>;
  twins: z.ZodOptional<z.ZodArray<z.ZodEnum<{
    mac: "mac";
    serial: "serial";
  }>>>;
  setup: z.ZodOptional<z.ZodString>;
  account: z.ZodOptional<z.ZodString>;
  transports: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodUnion<readonly [z.ZodString, z.ZodObject<{
    module: z.ZodString;
    wires: z.ZodArray<z.ZodEnum<{
      matter: "matter";
      mqtt: "mqtt";
      modbus: "modbus";
      http: "http";
      ble: "ble";
      zigbee: "zigbee";
      udp: "udp";
    }>>;
  }, z.core.$strict>]>>>;
  streams: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodString>>;
  containers: z.ZodDefault<z.ZodArray<z.ZodObject<{
    id: z.ZodString;
    name: z.ZodString;
    image: z.ZodString;
    minVersion: z.ZodString;
    volumes: z.ZodDefault<z.ZodArray<z.ZodObject<{
      name: z.ZodString;
      path: z.ZodString;
      cache: z.ZodDefault<z.ZodBoolean>;
    }, z.core.$strict>>>;
    env: z.ZodDefault<z.ZodArray<z.ZodObject<{
      name: z.ZodString;
      value: z.ZodString;
      when: z.ZodOptional<z.ZodObject<{
        key: z.ZodString;
        equals: z.ZodArray<z.ZodUnion<readonly [z.ZodString, z.ZodBoolean]>>;
      }, z.core.$strict>>;
    }, z.core.$strict>>>;
    devices: z.ZodDefault<z.ZodArray<z.ZodObject<{
      host: z.ZodString;
      container: z.ZodString;
      when: z.ZodOptional<z.ZodObject<{
        key: z.ZodString;
        equals: z.ZodArray<z.ZodUnion<readonly [z.ZodString, z.ZodBoolean]>>;
      }, z.core.$strict>>;
    }, z.core.$strict>>>;
    ports: z.ZodDefault<z.ZodArray<z.ZodObject<{
      container: z.ZodUnion<readonly [z.ZodInt, z.ZodString]>;
      host: z.ZodUnion<readonly [z.ZodInt, z.ZodString]>;
      protocol: z.ZodDefault<z.ZodEnum<{
        tcp: "tcp";
        udp: "udp";
      }>>;
      when: z.ZodOptional<z.ZodObject<{
        key: z.ZodString;
        equals: z.ZodArray<z.ZodUnion<readonly [z.ZodString, z.ZodBoolean]>>;
      }, z.core.$strict>>;
    }, z.core.$strict>>>;
    seed: z.ZodDefault<z.ZodArray<z.ZodObject<{
      volume: z.ZodString;
      path: z.ZodString;
      content: z.ZodString;
    }, z.core.$strict>>>;
    mqttTopics: z.ZodOptional<z.ZodArray<z.ZodString>>;
    webPort: z.ZodOptional<z.ZodUnion<readonly [z.ZodInt, z.ZodString]>>;
    webPortWhen: z.ZodOptional<z.ZodObject<{
      key: z.ZodString;
      equals: z.ZodArray<z.ZodUnion<readonly [z.ZodString, z.ZodBoolean]>>;
    }, z.core.$strict>>;
    command: z.ZodOptional<z.ZodArray<z.ZodString>>;
    healthcheck: z.ZodOptional<z.ZodObject<{
      test: z.ZodArray<z.ZodString>;
      intervalMs: z.ZodOptional<z.ZodInt>;
      timeoutMs: z.ZodOptional<z.ZodInt>;
      retries: z.ZodOptional<z.ZodInt>;
      startPeriodMs: z.ZodOptional<z.ZodInt>;
    }, z.core.$strict>>;
    dependsOn: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodEnum<{
      started: "started";
      healthy: "healthy";
    }>>>;
  }, z.core.$strict>>>;
  requires: z.ZodDefault<z.ZodObject<{
    platform: z.ZodOptional<z.ZodString>;
    packages: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodString>>;
    services: z.ZodDefault<z.ZodArray<z.ZodString>>;
  }, z.core.$strict>>;
  integrity: z.ZodOptional<z.ZodString>;
  signature: z.ZodOptional<z.ZodString>;
}, z.core.$strict>;
/** The contents of `manifest.json`. */
type VendorManifest = z.output<typeof vendorManifestSchema>;
/**
 * A driver as the runtime reads it: its own manifest joined with its vendor's.
 *
 * This is what every other part of the runtime and `hub` is written against, and what a test
 * builds by hand when it wants an integration without a directory. It is never read from a
 * file; {@link resolveManifest} composes it.
 */
declare const bundleManifestSchema: z.ZodObject<{
  transport: z.ZodString;
  models: z.ZodDefault<z.ZodArray<z.ZodString>>;
  modelCodes: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodString>]>>>;
  modelSeries: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
  kind: z.ZodEnum<{
    declarative: "declarative";
    code: "code";
    matter: "matter";
    mqtt: "mqtt";
    modbus: "modbus";
  }>;
  defaultIcon: z.ZodOptional<z.ZodString>;
  webPagePort: z.ZodOptional<z.ZodInt>;
  webPagePath: z.ZodOptional<z.ZodString>;
  profile: z.ZodOptional<z.ZodString>;
  entry: z.ZodOptional<z.ZodString>;
  template: z.ZodOptional<z.ZodString>;
  setup: z.ZodString;
  id: z.ZodString;
  version: z.ZodString;
  sdk: z.ZodString;
  name: z.ZodString;
  description: z.ZodOptional<z.ZodString>;
  vendor: z.ZodObject<{
    id: z.ZodString;
    name: z.ZodString;
    url: z.ZodOptional<z.ZodURL>;
  }, z.core.$strict>;
}, z.core.$strict>;
/** A driver as the runtime reads it. */
type BundleManifest = z.output<typeof bundleManifestSchema>;
//#endregion
//#region ../package-runtime/dist/profile.d.ts
/**
 * A value in a request template: a literal, or a path into the command.
 *
 * Recursive, so a nested query object can carry a path at any depth. Declared with an explicit
 * annotation for the same reason `jsonValueSchema` is: TypeScript cannot infer the type of a
 * schema that refers to itself.
 */
type TemplateValue = string | number | boolean | null | TemplateReference | TemplateValue[] | {
  readonly [key: string]: TemplateValue;
};
/** A path into the command, with what to do to what it names; see `templateReferenceSchema`. */
type TemplateReference = {
  readonly $: string;
  readonly scale?: number | undefined;
  readonly decimals?: number | undefined;
  readonly min?: number | undefined;
  readonly max?: number | undefined;
  readonly optional?: boolean | undefined;
};
//#endregion
//#region ../package-runtime/dist/discovery.d.ts
/** Validates a whole `discovery.json`. */
declare const vendorDiscoverySchema: z.ZodObject<{
  listen: z.ZodDefault<z.ZodArray<z.ZodUnion<readonly [z.ZodObject<{
    mdns: z.ZodString;
  }, z.core.$strict>, z.ZodObject<{
    module: z.ZodString;
    lan: z.ZodDefault<z.ZodBoolean>;
  }, z.core.$strict>]>>>;
  match: z.ZodDefault<z.ZodArray<z.ZodUnion<readonly [z.ZodObject<{
    path: z.ZodString;
    equals: z.ZodUnion<readonly [z.ZodString, z.ZodNumber, z.ZodBoolean]>;
  }, z.core.$strict>, z.ZodObject<{
    path: z.ZodString;
    exists: z.ZodLiteral<true>;
  }, z.core.$strict>, z.ZodObject<{
    path: z.ZodString;
    oneOf: z.ZodArray<z.ZodUnion<readonly [z.ZodString, z.ZodNumber, z.ZodBoolean]>>;
  }, z.core.$strict>, z.ZodObject<{
    path: z.ZodString;
    startsWith: z.ZodString;
  }, z.core.$strict>, z.ZodObject<{
    path: z.ZodString;
    endsWith: z.ZodString;
  }, z.core.$strict>, z.ZodObject<{
    path: z.ZodString;
    contains: z.ZodUnion<readonly [z.ZodString, z.ZodNumber, z.ZodBoolean]>;
  }, z.core.$strict>, z.ZodObject<{
    path: z.ZodString;
    min: z.ZodOptional<z.ZodNumber>;
    max: z.ZodOptional<z.ZodNumber>;
  }, z.core.$strict>]>>>;
  probe: z.ZodOptional<z.ZodObject<{
    transport: z.ZodString;
    op: z.ZodString;
    args: z.ZodDefault<z.ZodType<JsonObject, unknown, z.core.$ZodTypeInternals<JsonObject, unknown>>>;
    timeoutMs: z.ZodOptional<z.ZodInt>;
  }, z.core.$strict>>;
  identity: z.ZodDefault<z.ZodObject<{
    model: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodString>]>>;
    externalId: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodString>]>>;
    name: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodString>]>>;
    swVersion: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodString>]>>;
    mac: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodString>]>>;
    serialNumber: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodString>]>>;
    auth: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodString>]>>;
  }, z.core.$strict>>;
  matter: z.ZodOptional<z.ZodObject<{
    match: z.ZodArray<z.ZodUnion<readonly [z.ZodObject<{
      path: z.ZodString;
      equals: z.ZodUnion<readonly [z.ZodString, z.ZodNumber, z.ZodBoolean]>;
    }, z.core.$strict>, z.ZodObject<{
      path: z.ZodString;
      exists: z.ZodLiteral<true>;
    }, z.core.$strict>, z.ZodObject<{
      path: z.ZodString;
      oneOf: z.ZodArray<z.ZodUnion<readonly [z.ZodString, z.ZodNumber, z.ZodBoolean]>>;
    }, z.core.$strict>, z.ZodObject<{
      path: z.ZodString;
      startsWith: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
      path: z.ZodString;
      endsWith: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
      path: z.ZodString;
      contains: z.ZodUnion<readonly [z.ZodString, z.ZodNumber, z.ZodBoolean]>;
    }, z.core.$strict>, z.ZodObject<{
      path: z.ZodString;
      min: z.ZodOptional<z.ZodNumber>;
      max: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strict>]>>;
    model: z.ZodDefault<z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodString>]>>;
  }, z.core.$strict>>;
  mqtt: z.ZodOptional<z.ZodObject<{
    match: z.ZodArray<z.ZodUnion<readonly [z.ZodObject<{
      path: z.ZodString;
      equals: z.ZodUnion<readonly [z.ZodString, z.ZodNumber, z.ZodBoolean]>;
    }, z.core.$strict>, z.ZodObject<{
      path: z.ZodString;
      exists: z.ZodLiteral<true>;
    }, z.core.$strict>, z.ZodObject<{
      path: z.ZodString;
      oneOf: z.ZodArray<z.ZodUnion<readonly [z.ZodString, z.ZodNumber, z.ZodBoolean]>>;
    }, z.core.$strict>, z.ZodObject<{
      path: z.ZodString;
      startsWith: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
      path: z.ZodString;
      endsWith: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
      path: z.ZodString;
      contains: z.ZodUnion<readonly [z.ZodString, z.ZodNumber, z.ZodBoolean]>;
    }, z.core.$strict>, z.ZodObject<{
      path: z.ZodString;
      min: z.ZodOptional<z.ZodNumber>;
      max: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strict>]>>;
    model: z.ZodDefault<z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodString>]>>;
  }, z.core.$strict>>;
  modbus: z.ZodOptional<z.ZodObject<{
    match: z.ZodArray<z.ZodUnion<readonly [z.ZodObject<{
      path: z.ZodString;
      equals: z.ZodUnion<readonly [z.ZodString, z.ZodNumber, z.ZodBoolean]>;
    }, z.core.$strict>, z.ZodObject<{
      path: z.ZodString;
      exists: z.ZodLiteral<true>;
    }, z.core.$strict>, z.ZodObject<{
      path: z.ZodString;
      oneOf: z.ZodArray<z.ZodUnion<readonly [z.ZodString, z.ZodNumber, z.ZodBoolean]>>;
    }, z.core.$strict>, z.ZodObject<{
      path: z.ZodString;
      startsWith: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
      path: z.ZodString;
      endsWith: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
      path: z.ZodString;
      contains: z.ZodUnion<readonly [z.ZodString, z.ZodNumber, z.ZodBoolean]>;
    }, z.core.$strict>, z.ZodObject<{
      path: z.ZodString;
      min: z.ZodOptional<z.ZodNumber>;
      max: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strict>]>>;
    model: z.ZodDefault<z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodString>]>>;
    unitId: z.ZodDefault<z.ZodInt>;
    read: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodObject<{
      function: z.ZodUnion<readonly [z.ZodLiteral<1>, z.ZodLiteral<2>, z.ZodLiteral<3>, z.ZodLiteral<4>]>;
      address: z.ZodUnion<readonly [z.ZodInt, z.ZodString]>;
      type: z.ZodOptional<z.ZodEnum<{
        string: "string";
        u16: "u16";
        s16: "s16";
        u32: "u32";
        s32: "s32";
        f32: "f32";
      }>>;
      count: z.ZodOptional<z.ZodInt>;
      bit: z.ZodOptional<z.ZodInt>;
      scale: z.ZodOptional<z.ZodNumber>;
      unit: z.ZodOptional<z.ZodString>;
      options: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
    }, z.core.$strict>>>;
  }, z.core.$strict>>;
  adopt: z.ZodDefault<z.ZodEnum<{
    owner: "owner";
    automatic: "automatic";
  }>>;
  pairing: z.ZodOptional<z.ZodObject<{
    driver: z.ZodString;
    open: z.ZodString;
    close: z.ZodString;
    state: z.ZodString;
  }, z.core.$strict>>;
}, z.core.$strict>;
/** A whole `discovery.json`, parsed. */
type VendorDiscovery = z.output<typeof vendorDiscoverySchema>;
/** A driver, as far as discovery needs one: its name, its models and their codes. */
type DiscoveryDriver = {
  readonly id: string;
  /** The driver's own name, offered as its one model when it lists none. */
  readonly name: string;
  /**
   * What reaches its devices. A driver on a broker's transport - `matter`, `mqtt-house` - takes
   * only that broker's devices, and no other driver does.
   */
  readonly transport: string;
  readonly models: readonly string[];
  readonly modelCodes?: Readonly<Record<string, string | readonly string[]>> | undefined;
};
/** A vendor's discovery, checked against its drivers and ready to answer. */
type DiscoveryPlan = {
  readonly vendorId: string;
  readonly discovery: VendorDiscovery;
  readonly drivers: readonly DiscoveryDriver[];
  /** Every code any driver maps, and the drivers and models it names, in load order. */
  readonly codes: ReadonlyMap<string, readonly CodedModels[]>;
};
/** What one driver maps one code onto. */
type CodedModels = {
  readonly driverId: string;
  readonly models: readonly string[];
};
/** Who a sighted device says it is. Each field is null when it did not say. */
type SightingIdentity = {
  readonly externalId: string | null;
  readonly name: string | null;
  readonly modelCode: string | null;
  readonly swVersion: string | null;
  /** Lower case with colons. */
  readonly mac: string | null;
  readonly serialNumber: string | null;
  /** Whether it said it is behind a password; false when it did not say. */
  readonly needsPassword: boolean;
};
/** The driver a device belongs to, and which of its models it is. */
type Association = {
  readonly driverId: string;
  /** The model, when it is certain; null when the owner has to pick among the choices. */
  readonly model: string | null;
  /** What the owner may pick from: the family a code names, or every model of the driver. */
  readonly modelChoices: readonly string[];
};
/**
 * What a listening source heard: a device, how to reach it, and what it said.
 *
 * `config` is what reaches it in the transport's own terms - `{ host }` - and becomes the
 * device's connection once adopted. `payload` is what identity and match read.
 */
type Sighting = {
  readonly config: JsonObject;
  readonly payload: JsonObject;
};
/** How a listener is getting on, as the vendor's page says it. */
type ListenerStatus = {
  /** `ok` hears what it listens to; `warning` listens but hears nothing; `error` cannot listen. */
  readonly level: 'ok' | 'warning' | 'error';
  /** A sentence for the owner: where it listens, and what to look at when it hears nothing. */
  readonly message: string;
};
/**
 * A device a listener heard and does not report, and why: one its vendor does not support, one
 * still being paired. The vendor's page lists them, so "why is my device not here" has an answer.
 */
type PassedOverSighting = {
  /** What tells it from the others: its IEEE address, its id on the account. */
  readonly id: string;
  readonly name: string;
  readonly model?: string | null;
  /** Why it is not added, in a sentence: `Zigbee2MQTT is still pairing it`. */
  readonly reason: string;
};
/** What the hub hands a listener beside the signal. */
type DiscoveryListenContext = {
  /**
   * Reads what the owner saved for the vendor - an account, a key - secrets opened, for a
   * listener that asks a cloud which devices the account has. Read it at every pass rather than
   * once: a change the owner saves is then heard without the listener being started again.
   *
   * @returns The vendor's settings; empty while it is not set up.
   */
  readonly settings: () => Promise<JsonObject>;
  /**
   * Says how listening goes - connected to a broker but hearing nothing, unable to
   * reach it - which the vendor's page shows. The last one said stands until the next. Optional
   * for the hub to offer, so a listener calls it as `context.status?.(…)`.
   */
  readonly status?: (status: ListenerStatus) => void;
  /**
   * Every device the listener hears and does not report, the whole list each time -
   * it replaces the last one. Optional for the hub to offer, like `status`.
   */
  readonly passedOver?: (devices: readonly PassedOverSighting[]) => void;
  /**
   * Every account of the vendor signed in to, for a listener that asks each which
   * devices it has. Read it at every pass, like the settings: an account added is heard then.
   *
   * @returns The accounts; none for a vendor without, or before one is signed in to.
   */
  readonly accounts?: () => Promise<readonly AccountHandle[]>;
};
/** A vendor's own listener, for a protocol the platform does not speak. */
type DiscoverySource = {
  /**
   * Listens until the signal ends it, reporting every device heard.
   *
   * @param signal - Ends the listening.
   * @param context - The vendor's settings, for a listener that needs them.
   * @returns Every sighting, as it happens. The same device may be reported again.
   */
  listen: (signal: AbortSignal, context: DiscoveryListenContext) => AsyncIterable<Sighting>;
  /**
   * Asks the network again now, rather than at the listener's own next pass: what the owner's
   * "look for devices" reaches. Optional, for a listener that only ever hears announcements and
   * has nothing to ask. Answers arrive through `listen`, like every other sighting.
   */
  scan?: () => void;
};
//#endregion
//#region ../package-runtime/dist/install-marker.d.ts
/** The contents of `.nebula-install.json`. */
type InstallMarker = IntegrationInstall;
//#endregion
//#region ../package-runtime/dist/loader.d.ts
/** A driver that loaded. */
type LoadedBundle = {
  /** The driver's manifest joined with its vendor's, keyed by the kind. */
  readonly manifest: BundleManifest;
  readonly vendorId: string;
  readonly driverId: string;
  /** The driver's own name, without the vendor's in front: `Gen2`, `Printer`. */
  readonly driverName: string;
  readonly integration: Integration;
  /** What setting up an instance asks, for the catalogue to serve and the API to check against. */
  readonly setup: IntegrationSetup;
  /** Where it was read from, for a message that has to name it. */
  readonly directory: string;
  /** The template a Modbus driver reads its devices through, every entity with its id. */
  readonly modbusTemplate?: ModbusTemplate;
};
/**
 * Which of the two places a vendor was read from.
 *
 * `installed` is the data directory's `hub/integrations`: where the platform installs a vendor
 * from the integrations index or its local folder, and the only place a production hub reads.
 * `development` is a directory of bundles under development - an integration repository's
 * `dist/`, named in the hub's `HUB_DEV_BUNDLE_DIR` - read beside it. `platform` is no place at
 * all: the vendors the hub is itself, `matter` and `mqtt`, built in code.
 */
type BundleOrigin = 'development' | 'installed' | 'platform';
/** Where a vendor's devices announce themselves, ready to listen to. */
type LoadedListenSource = {
  readonly kind: 'mdns';
  readonly service: string;
} | {
  readonly kind: 'module';
  readonly file: string;
  readonly source: DiscoverySource;
  /** Whether it listens on the house's network, and is off where the hub cannot hear it. */
  readonly lan: boolean;
};
/** How a vendor's devices are found: its plan, checked against its drivers, and its sources. */
type LoadedDiscovery = {
  readonly plan: DiscoveryPlan;
  readonly sources: readonly LoadedListenSource[];
};
/** A vendor's account: what signing in asks, and the module that does it. */
type LoadedAccount = {
  readonly declaration: AccountDeclaration;
  readonly module: AccountModule;
};
/** A vendor that loaded, with the drivers of it that did. */
type LoadedVendor = {
  readonly manifest: VendorManifest;
  /** Which of the two places it was read from. */
  readonly origin: BundleOrigin;
  /** How the platform installed it, for one it did: its marker. */
  readonly install?: InstallMarker;
  /** What setting the vendor up asks; empty groups when it asks for nothing. */
  readonly setup: IntegrationSetup;
  /** The logo as an image data URL, when the bundle ships one. */
  readonly logo?: string;
  /** Every transport one of its drivers speaks, each once, in the drivers' order. */
  readonly transports: readonly string[];
  /** The wires its devices are reached over, for its card: see {@link wiresOf}. */
  readonly wires: readonly TransportWire[];
  /** The transports the vendor ships itself, ready to register: `shelly/rpc`. */
  readonly ownTransports: readonly Transport[];
  /** The stream sources the vendor ships, ready to register: `bambulab/camera`. */
  readonly streams: readonly StreamSource[];
  readonly drivers: readonly LoadedBundle[];
  /** How its devices are found, when it has a `discovery.json` that loaded. */
  readonly discovery?: LoadedDiscovery;
  /**
   * The account its devices are reached through, when it has an `account.json` - what
   * signing in asks, and the module that signs in.
   */
  readonly account?: LoadedAccount;
  /** Where it was read from, for a message that has to name it. */
  readonly directory: string;
  /**
   * Lets go of what the vendor's code holds: every UDP socket it opened.
   *
   * @returns A promise that settles once every port it held is free.
   */
  readonly release: () => Promise<void>;
};
/** A vendor or a driver that did not load, and why. */
type BundleFailure = {
  readonly directory: string;
  readonly message: string;
  /** The vendor it belongs to - its folder's name - when the failure is inside one. */
  readonly vendorId?: string;
};
//#endregion
export { TransportSubscription as C, CapabilityState as D, CapabilityName as E, TransportRequest as S, JsonObject as T, Claim as _, LoadedListenSource as a, ReportedState as b, SightingIdentity as c, ManagedSocketClose as d, ManagedSocketHeaders as f, UdpPeer as g, PlatformServices as h, LoadedDiscovery as i, TemplateValue as l, ManagedUdpSocketOptions as m, LoadedAccount as n, LoadedVendor as o, ManagedSocketOptions as p, LoadedBundle as r, Association as s, BundleFailure as t, BundleSdk as u, DeviceDescriptor as v, EntityId as w, Discovered as x, Integration as y };