/**
 * The devices saying they are set up differently, waited on before they are described again.
 *
 * A Bot switched to switch mode in its vendor's app says so in every advertisement after; one
 * advertisement read wrong says so once. So a new setup is taken only when the device still says
 * it {@link REDESCRIBE_AFTER_MS} later, and a message saying the claim's own again drops it.
 */
import { REDESCRIBE_AFTER_MS, type Claim } from '@nebulahome/package-runtime';

/** The devices waited on, by instance. */
export class SetUpWaits {
  readonly #waiting = new Map<string, { readonly said: string; readonly timer: NodeJS.Timeout }>();

  /**
   * Follows what a device says it is set up as.
   *
   * @param instanceId - The instance, which is the device's id.
   * @param claim - The claim, with the descriptor the device says now.
   * @param isNew - Whether that is not the claim's own.
   * @param onDue - Called with the claim once the device still says it after the wait.
   */
  public follow(
    instanceId: string,
    claim: Claim,
    isNew: boolean,
    onDue: (claim: Claim) => void,
  ): void {
    const said = JSON.stringify(claim.descriptor);
    const waiting = this.#waiting.get(instanceId);

    if (waiting !== undefined && (!isNew || waiting.said !== said)) {
      this.drop(instanceId);
    }

    if (!isNew || this.#waiting.has(instanceId)) {
      return;
    }

    const timer = setTimeout(() => {
      this.#waiting.delete(instanceId);
      onDue(claim);
    }, REDESCRIBE_AFTER_MS);

    timer.unref();
    this.#waiting.set(instanceId, { said, timer });
  }

  /**
   * Stops waiting on a device: its instance stopped, or it said its claim's own again.
   *
   * @param instanceId - The instance.
   */
  public drop(instanceId: string): void {
    clearTimeout(this.#waiting.get(instanceId)?.timer);
    this.#waiting.delete(instanceId);
  }
}
