import { T as JsonObject, l as TemplateValue } from "./chunks/node-index.js";
import { z } from "zod";
//#region src/schemas.d.ts
/** Each file's schema, by the name its JSON Schema is written under. */
export declare const BUNDLE_FILE_SCHEMAS: {
  readonly manifest: z.ZodObject<{
    id: z.ZodString;
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
        udp: "udp";
        matter: "matter";
        mqtt: "mqtt";
        modbus: "modbus";
        http: "http";
        ble: "ble";
        zigbee: "zigbee";
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
  }, z.core.$strict>;
  readonly driver: z.ZodObject<{
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
    name: z.ZodString;
  }, z.core.$strict>;
  readonly setup: z.ZodObject<{
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
  readonly profile: z.ZodObject<{
    discovery: z.ZodObject<{
      scan: z.ZodDefault<z.ZodType<JsonObject, unknown, z.core.$ZodTypeInternals<JsonObject, unknown>>>;
      probe: z.ZodOptional<z.ZodObject<{
        op: z.ZodString;
        args: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodType<TemplateValue, unknown, z.core.$ZodTypeInternals<TemplateValue, unknown>>>>;
      }, z.core.$strict>>;
      claim: z.ZodArray<z.ZodUnion<readonly [z.ZodObject<{
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
      identity: z.ZodObject<{
        externalId: z.ZodString;
        name: z.ZodOptional<z.ZodString>;
        manufacturer: z.ZodOptional<z.ZodString>;
        model: z.ZodOptional<z.ZodString>;
        swVersion: z.ZodOptional<z.ZodString>;
        hwVersion: z.ZodOptional<z.ZodString>;
        mac: z.ZodOptional<z.ZodString>;
        serialNumber: z.ZodOptional<z.ZodString>;
      }, z.core.$strict>;
    }, z.core.$strict>;
    subscriptions: z.ZodDefault<z.ZodArray<z.ZodObject<{
      op: z.ZodString;
      args: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodType<TemplateValue, unknown, z.core.$ZodTypeInternals<TemplateValue, unknown>>>>;
    }, z.core.$strict>>>;
    device: z.ZodOptional<z.ZodObject<{
      swVersion: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodString>]>>;
      hwVersion: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodString>]>>;
    }, z.core.$strict>>;
    entities: z.ZodArray<z.ZodObject<{
      domain: z.ZodEnum<{
        number: "number";
        image: "image";
        custom: "custom";
        light: "light";
        switch: "switch";
        sensor: "sensor";
        binary_sensor: "binary_sensor";
        cover: "cover";
        lock: "lock";
        climate: "climate";
        media_player: "media_player";
        camera: "camera";
        button: "button";
        update: "update";
        lawn_mower: "lawn_mower";
        select: "select";
        vacuum: "vacuum";
        alias: "alias";
      }>;
      objectId: z.ZodOptional<z.ZodString>;
      name: z.ZodOptional<z.ZodString>;
      icon: z.ZodOptional<z.ZodString>;
      capabilities: z.ZodRecord<z.ZodEnum<{
        number: "number";
        custom: "custom";
        select: "select";
        button: "button";
        sensor_numeric: "sensor_numeric";
        sensor_text: "sensor_text";
        sensor_binary: "sensor_binary";
        on_off: "on_off";
        level: "level";
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
        image: "image";
      }> & z.core.$partial, z.ZodType<JsonObject, unknown, z.core.$ZodTypeInternals<JsonObject, unknown>>>;
      state: z.ZodRecord<z.ZodEnum<{
        number: "number";
        on_off: "on_off";
        level: "level";
        color_hs: "color_hs";
        color_temp: "color_temp";
        cover: "cover";
        lock: "lock";
        thermostat: "thermostat";
        sensor_numeric: "sensor_numeric";
        sensor_binary: "sensor_binary";
        sensor_text: "sensor_text";
        media_player: "media_player";
        camera: "camera";
        button: "button";
        update: "update";
        lawn_mower: "lawn_mower";
        select: "select";
        vacuum: "vacuum";
        image: "image";
        custom: "custom";
      }> & z.core.$partial, z.ZodRecord<z.ZodString, z.ZodUnion<readonly [z.ZodUnion<readonly [z.ZodString, z.ZodObject<{
        path: z.ZodString;
        bits: z.ZodOptional<z.ZodTuple<[z.ZodInt, z.ZodInt], null>>;
        base: z.ZodOptional<z.ZodUnion<readonly [z.ZodLiteral<10>, z.ZodLiteral<16>]>>;
        equals: z.ZodUnion<readonly [z.ZodString, z.ZodNumber, z.ZodBoolean]>;
      }, z.core.$strict>, z.ZodObject<{
        path: z.ZodString;
        present: z.ZodLiteral<true>;
      }, z.core.$strict>, z.ZodObject<{
        path: z.ZodString;
        bits: z.ZodOptional<z.ZodTuple<[z.ZodInt, z.ZodInt], null>>;
        base: z.ZodOptional<z.ZodUnion<readonly [z.ZodLiteral<10>, z.ZodLiteral<16>]>>;
        map: z.ZodRecord<z.ZodString, z.ZodUnion<readonly [z.ZodString, z.ZodNumber, z.ZodBoolean]>>;
        default: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodNumber, z.ZodBoolean]>>;
      }, z.core.$strict>, z.ZodObject<{
        path: z.ZodString;
        bits: z.ZodOptional<z.ZodTuple<[z.ZodInt, z.ZodInt], null>>;
        base: z.ZodOptional<z.ZodUnion<readonly [z.ZodLiteral<10>, z.ZodLiteral<16>]>>;
      }, z.core.$strict>]>, z.ZodArray<z.ZodUnion<readonly [z.ZodString, z.ZodObject<{
        path: z.ZodString;
        bits: z.ZodOptional<z.ZodTuple<[z.ZodInt, z.ZodInt], null>>;
        base: z.ZodOptional<z.ZodUnion<readonly [z.ZodLiteral<10>, z.ZodLiteral<16>]>>;
        equals: z.ZodUnion<readonly [z.ZodString, z.ZodNumber, z.ZodBoolean]>;
      }, z.core.$strict>, z.ZodObject<{
        path: z.ZodString;
        present: z.ZodLiteral<true>;
      }, z.core.$strict>, z.ZodObject<{
        path: z.ZodString;
        bits: z.ZodOptional<z.ZodTuple<[z.ZodInt, z.ZodInt], null>>;
        base: z.ZodOptional<z.ZodUnion<readonly [z.ZodLiteral<10>, z.ZodLiteral<16>]>>;
        map: z.ZodRecord<z.ZodString, z.ZodUnion<readonly [z.ZodString, z.ZodNumber, z.ZodBoolean]>>;
        default: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodNumber, z.ZodBoolean]>>;
      }, z.core.$strict>, z.ZodObject<{
        path: z.ZodString;
        bits: z.ZodOptional<z.ZodTuple<[z.ZodInt, z.ZodInt], null>>;
        base: z.ZodOptional<z.ZodUnion<readonly [z.ZodLiteral<10>, z.ZodLiteral<16>]>>;
      }, z.core.$strict>]>>]>>>;
      commands: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodObject<{
        op: z.ZodString;
        args: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodType<TemplateValue, unknown, z.core.$ZodTypeInternals<TemplateValue, unknown>>>>;
      }, z.core.$strict>>>;
      attributes: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnion<readonly [z.ZodUnion<readonly [z.ZodString, z.ZodObject<{
        path: z.ZodString;
        bits: z.ZodOptional<z.ZodTuple<[z.ZodInt, z.ZodInt], null>>;
        base: z.ZodOptional<z.ZodUnion<readonly [z.ZodLiteral<10>, z.ZodLiteral<16>]>>;
        equals: z.ZodUnion<readonly [z.ZodString, z.ZodNumber, z.ZodBoolean]>;
      }, z.core.$strict>, z.ZodObject<{
        path: z.ZodString;
        present: z.ZodLiteral<true>;
      }, z.core.$strict>, z.ZodObject<{
        path: z.ZodString;
        bits: z.ZodOptional<z.ZodTuple<[z.ZodInt, z.ZodInt], null>>;
        base: z.ZodOptional<z.ZodUnion<readonly [z.ZodLiteral<10>, z.ZodLiteral<16>]>>;
        map: z.ZodRecord<z.ZodString, z.ZodUnion<readonly [z.ZodString, z.ZodNumber, z.ZodBoolean]>>;
        default: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodNumber, z.ZodBoolean]>>;
      }, z.core.$strict>, z.ZodObject<{
        path: z.ZodString;
        bits: z.ZodOptional<z.ZodTuple<[z.ZodInt, z.ZodInt], null>>;
        base: z.ZodOptional<z.ZodUnion<readonly [z.ZodLiteral<10>, z.ZodLiteral<16>]>>;
      }, z.core.$strict>]>, z.ZodArray<z.ZodUnion<readonly [z.ZodString, z.ZodObject<{
        path: z.ZodString;
        bits: z.ZodOptional<z.ZodTuple<[z.ZodInt, z.ZodInt], null>>;
        base: z.ZodOptional<z.ZodUnion<readonly [z.ZodLiteral<10>, z.ZodLiteral<16>]>>;
        equals: z.ZodUnion<readonly [z.ZodString, z.ZodNumber, z.ZodBoolean]>;
      }, z.core.$strict>, z.ZodObject<{
        path: z.ZodString;
        present: z.ZodLiteral<true>;
      }, z.core.$strict>, z.ZodObject<{
        path: z.ZodString;
        bits: z.ZodOptional<z.ZodTuple<[z.ZodInt, z.ZodInt], null>>;
        base: z.ZodOptional<z.ZodUnion<readonly [z.ZodLiteral<10>, z.ZodLiteral<16>]>>;
        map: z.ZodRecord<z.ZodString, z.ZodUnion<readonly [z.ZodString, z.ZodNumber, z.ZodBoolean]>>;
        default: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodNumber, z.ZodBoolean]>>;
      }, z.core.$strict>, z.ZodObject<{
        path: z.ZodString;
        bits: z.ZodOptional<z.ZodTuple<[z.ZodInt, z.ZodInt], null>>;
        base: z.ZodOptional<z.ZodUnion<readonly [z.ZodLiteral<10>, z.ZodLiteral<16>]>>;
      }, z.core.$strict>]>>]>>>;
      unitOfMeasurement: z.ZodOptional<z.ZodString>;
      deviceClass: z.ZodOptional<z.ZodString>;
      stateClass: z.ZodOptional<z.ZodEnum<{
        measurement: "measurement";
        total: "total";
        total_increasing: "total_increasing";
      }>>;
      displayPrecision: z.ZodOptional<z.ZodInt>;
      link: z.ZodOptional<z.ZodObject<{
        key: z.ZodOptional<z.ZodString>;
        matter: z.ZodOptional<z.ZodObject<{
          endpoint: z.ZodInt;
          cluster: z.ZodInt;
          attribute: z.ZodInt;
        }, z.core.$strict>>;
      }, z.core.$strict>>;
      stream: z.ZodOptional<z.ZodObject<{
        source: z.ZodString;
        args: z.ZodDefault<z.ZodType<JsonObject, unknown, z.core.$ZodTypeInternals<JsonObject, unknown>>>;
      }, z.core.$strict>>;
      image: z.ZodOptional<z.ZodObject<{
        path: z.ZodString;
        contentType: z.ZodEnum<{
          "image/svg+xml": "image/svg+xml";
          "image/png": "image/png";
          "image/jpeg": "image/jpeg";
        }>;
        encoding: z.ZodDefault<z.ZodEnum<{
          base64: "base64";
          utf8: "utf8";
        }>>;
        minIntervalMs: z.ZodDefault<z.ZodInt>;
      }, z.core.$strict>>;
    }, z.core.$strict>>;
  }, z.core.$strict>;
  readonly discovery: z.ZodObject<{
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
  readonly account: z.ZodObject<{
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
  readonly 'modbus-template': z.ZodObject<{
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
      icon: z.ZodOptional<z.ZodString>;
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
        select: "select";
        button: "button";
        sensor_numeric: "sensor_numeric";
        sensor_text: "sensor_text";
        sensor_binary: "sensor_binary";
        on_off: "on_off";
        level: "level";
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
};
/** The names of the files a JSON Schema is written for. */
export type BundleFileName = keyof typeof BUNDLE_FILE_SCHEMAS;
/**
 * One file's JSON Schema, with room for the `$schema` that points at it.
 *
 * @param name - The file.
 * @returns The JSON Schema.
 */
export declare function jsonSchemaOf(name: BundleFileName): Record<string, unknown>;
//#endregion