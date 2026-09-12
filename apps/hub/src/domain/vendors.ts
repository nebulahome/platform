/**
 * What a vendor's shared settings mean to one of its instances.
 *
 * A cloud vendor asks for an API key once, in its own `setup.json`; every device of theirs then
 * needs it in its transport configuration. Rather than copying the key into each row - and
 * re-copying it when it changes - the row holds only what the owner typed for that device, and
 * the vendor's settings are put under it when the instance starts. The instance wins where both
 * say something: a vendor-wide default is what a device inherits, not what it is held to.
 *
 * Pure, so the rule is tested without a database: the service reads the row, opens its secrets,
 * and hands both here.
 */
import {
  asksAnythingRequired,
  type IntegrationSetup,
  type JsonObject,
} from '@nebula-home/contracts';

/** The two documents a configuration is made of, whether a vendor's or an instance's. */
export type VendorSettings = {
  readonly transportConfig: JsonObject;
  readonly options: JsonObject;
};

/**
 * Whether a vendor still has to be set up before its devices can connect.
 *
 * True only when the vendor asks for something required and nobody has answered: a vendor
 * whose fields are all optional never needs it, and one with a row has been asked. Whether the
 * row is complete was the API's check when it was written.
 *
 * @param setup - What the vendor asks.
 * @param saved - What the owner saved, if anything.
 * @returns True when the vendor must be set up first.
 */
export function needsSetup(setup: IntegrationSetup, saved: VendorSettings | undefined): boolean {
  return saved === undefined && asksAnythingRequired(setup);
}

/**
 * Puts a vendor's settings under one of its instances.
 *
 * @param instance - As read from the registry and opened.
 * @param vendorName - What to call the vendor in a message.
 * @param setup - What the vendor asks.
 * @param saved - What the owner saved for it, secrets opened, if anything.
 * @returns The instance with the vendor's values beneath its own.
 * @throws {Error} When the vendor asks for something required and nothing is saved: the
 * instance cannot connect, and the message says which page fixes that.
 */
export function withVendorSettings<TInstance extends VendorSettings>(
  instance: TInstance,
  vendorName: string,
  setup: IntegrationSetup,
  saved: VendorSettings | undefined,
): TInstance {
  if (needsSetup(setup, saved)) {
    throw new Error(`${vendorName} needs setting up before its devices can connect`);
  }

  return {
    ...instance,
    transportConfig: { ...saved?.transportConfig, ...instance.transportConfig },
    options: { ...saved?.options, ...instance.options },
  };
}
