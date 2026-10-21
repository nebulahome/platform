/**
 * What the broker hears, as devices: every entity announced, mapped or the broker's own, grouped
 * by the device it belongs to, with the last text of every topic one of them is read from.
 *
 * Every message the broker carries is offered to {@link MqttHouse.hear}; one on a topic an entity
 * is read from is kept, and the devices reading it are told which topic changed. What a text
 * means - which capability, which state - is the platform's MQTT mapping's, in the integration
 * that runs the device; the house only keeps what it needs, so that a device's state can always
 * be computed again from every topic it reads.
 */
import {
  mqttDeviceSnapshotOf,
  mqttTopicsOf,
  type MqttDeviceSnapshot,
  type MqttEntity,
  type MqttEntityOrigin,
  type MqttSkipped,
} from '@nebulahome/package-runtime';

/** How many announcements not taken are kept: a network of unsupported things says the same. */
const MAXIMUM_SKIPPED = 100;

/**
 * Hears a device's topics change.
 *
 * @param deviceKey - The device.
 * @param changed - The topics that changed; null when the device itself did - an entity came,
 *   went or changed - and everything is to be read again.
 */
export type HouseListener = (deviceKey: string, changed: readonly string[] | null) => void;

/** Everything the broker hears, as devices. */
export class MqttHouse {
  readonly #held = new Map<string, MqttEntity>();

  /** Which entity each announcement topic made, for its removal. */
  readonly #announced = new Map<string, string>();

  readonly #skipped = new Map<string, MqttSkipped>();

  /** The last text of every topic an entity is read from. */
  readonly #texts = new Map<string, string>();

  /** The devices that read each topic. */
  #byTopic = new Map<string, Set<string>>();

  readonly #listeners = new Set<HouseListener>();

  /**
   * Follows the devices' topics.
   *
   * @param listener - Told a device changed, and which of its topics.
   * @returns What stops following.
   */
  public onChange(listener: HouseListener): () => void {
    this.#listeners.add(listener);

    return () => {
      this.#listeners.delete(listener);
    };
  }

  /**
   * Puts one entity in place of the one of its key, or adds it.
   *
   * @param entity - The entity.
   * @param announcedOn - The announcement topic it came on, when it came through discovery.
   * @param lastText - The last text a topic carried, for a state retained before the announcement.
   */
  public put(
    entity: MqttEntity,
    announcedOn: string | undefined,
    lastText: (topic: string) => string | undefined,
  ): void {
    const before = this.#held.get(entity.key);

    if (announcedOn !== undefined) {
      this.#announced.set(announcedOn, entity.key);
      this.#skipped.delete(announcedOn);
    }

    if (before !== undefined && JSON.stringify(before) === JSON.stringify(entity)) {
      return;
    }

    this.#held.set(entity.key, entity);

    // What was retained before it was announced: its state is there already.
    for (const topic of mqttTopicsOf(entity)) {
      const text = lastText(topic);

      if (text !== undefined) {
        this.#texts.set(topic, text);
      }
    }

    this.#changed([entity.device.id, ...(before === undefined ? [] : [before.device.id])]);
  }

  /**
   * Takes back an entity.
   *
   * @param key - Its key, or the announcement topic it came on.
   */
  public remove(key: string): void {
    const found = this.#announced.get(key) ?? key;
    const held = this.#held.get(found);

    this.#announced.delete(key);

    if (held !== undefined) {
      this.#held.delete(found);
      this.#changed([held.device.id]);
    }
  }

  /**
   * Takes back every entity of an origin but those kept.
   *
   * @param origin - `mapping`, when the owner's mappings are read again.
   * @param kept - The keys that stay.
   */
  public retain(origin: MqttEntityOrigin, kept: ReadonlySet<string>): void {
    const gone = [...this.#held.values()].filter(
      (entity) => entity.origin === origin && !kept.has(entity.key),
    );

    for (const entity of gone) {
      this.#held.delete(entity.key);
    }

    if (gone.length > 0) {
      this.#changed(gone.map((entity) => entity.device.id));
    }
  }

  /**
   * Notes an announcement that was not taken.
   *
   * @param skipped - Where, and why.
   */
  public skip(skipped: MqttSkipped): void {
    this.#skipped.delete(skipped.topic);
    this.#skipped.set(skipped.topic, skipped);

    if (this.#skipped.size > MAXIMUM_SKIPPED) {
      const [oldest] = this.#skipped.keys();

      if (oldest !== undefined) {
        this.#skipped.delete(oldest);
      }
    }
  }

  /**
   * The announcements that were not taken, the newest last.
   *
   * @returns Where, and why.
   */
  public skipped(): MqttSkipped[] {
    return [...this.#skipped.values()];
  }

  /**
   * How many entities there are of each origin, and how many devices.
   *
   * @returns The counts.
   */
  public counts(): { announced: number; mapped: number; devices: number } {
    const held = [...this.#held.values()].filter((entity) => entity.origin !== 'broker');

    return {
      announced: held.filter((entity) => entity.origin === 'discovery').length,
      mapped: held.filter((entity) => entity.origin === 'mapping').length,
      devices: new Set(held.map((entity) => entity.device.id)).size,
    };
  }

  /**
   * Every device, whole.
   *
   * @returns Them, in the order their first entity came.
   */
  public devices(): MqttDeviceSnapshot[] {
    return [...this.#byDevice().values()].flatMap((entities) => {
      const device = mqttDeviceSnapshotOf(entities);

      return device === undefined ? [] : [device];
    });
  }

  /**
   * One device, whole.
   *
   * @param deviceKey - Which.
   * @returns It, or undefined when the broker does not hear it.
   */
  public device(deviceKey: string): MqttDeviceSnapshot | undefined {
    return mqttDeviceSnapshotOf(
      [...this.#held.values()].filter((entity) => entity.device.id === deviceKey),
    );
  }

  /**
   * The last text of every topic a device's entities are read from.
   *
   * @param device - The device.
   * @returns Each topic that carried text.
   */
  public textsOf(device: MqttDeviceSnapshot): Record<string, string> {
    const texts: Record<string, string> = {};

    for (const entity of device.entities) {
      for (const topic of mqttTopicsOf(entity)) {
        const text = this.#texts.get(topic);

        if (text !== undefined) {
          texts[topic] = text;
        }
      }
    }

    return texts;
  }

  /**
   * Offers one message the broker carried.
   *
   * @param topic - Where it was published.
   * @param text - What, as text.
   */
  public hear(topic: string, text: string): void {
    const readers = this.#byTopic.get(topic);

    if (readers === undefined) {
      return;
    }

    this.#texts.set(topic, text);

    for (const deviceKey of readers) {
      for (const listener of this.#listeners) {
        listener(deviceKey, [topic]);
      }
    }
  }

  /**
   * The entities, by the device they belong to.
   *
   * @returns Them.
   */
  #byDevice(): Map<string, MqttEntity[]> {
    const byDevice = new Map<string, MqttEntity[]>();

    for (const entity of this.#held.values()) {
      byDevice.set(entity.device.id, [...(byDevice.get(entity.device.id) ?? []), entity]);
    }

    return byDevice;
  }

  /**
   * Rebuilds which devices read each topic, forgets the texts nobody reads, and tells the
   * devices that changed.
   *
   * @param deviceKeys - The devices whose entities changed.
   */
  #changed(deviceKeys: readonly string[]): void {
    const byTopic = new Map<string, Set<string>>();

    for (const entity of this.#held.values()) {
      for (const topic of mqttTopicsOf(entity)) {
        byTopic.set(topic, (byTopic.get(topic) ?? new Set()).add(entity.device.id));
      }
    }

    this.#byTopic = byTopic;

    for (const topic of this.#texts.keys()) {
      if (!byTopic.has(topic)) {
        this.#texts.delete(topic);
      }
    }

    for (const deviceKey of new Set(deviceKeys)) {
      for (const listener of this.#listeners) {
        listener(deviceKey, null);
      }
    }
  }
}
