/**
 * Picking a colour from anywhere on the screen, where the browser can.
 *
 * Chromium's EyeDropper API: a magnifier the person moves over anything on the screen - the
 * page, another window, a photo on the desktop - and the colour under it comes back. Firefox and
 * Safari have no such thing, so the hook says whether it is there and the control that uses it
 * shows its button only when it is. Picking needs a click to start it, as the API requires.
 */
import { useCallback } from 'react';

/** The part of the API used here; the DOM types do not carry it yet. */
type EyeDropperApi = new () => {
  open: (options?: { signal?: AbortSignal }) => Promise<{ sRGBHex: string }>;
};

/** What the hook gives. */
export type EyeDropper = {
  /** Whether this browser can pick from the screen at all. */
  readonly isSupported: boolean;

  /**
   * Lets the person pick a colour.
   *
   * @returns The colour as `#rrggbb`, or null when they gave up with Escape.
   */
  readonly pick: () => Promise<string | null>;
};

/**
 * Reads the API off the window, when the browser has it.
 *
 * @returns The constructor, or undefined.
 */
function eyeDropperApi(): EyeDropperApi | undefined {
  const candidate: unknown = (window as unknown as { EyeDropper?: unknown }).EyeDropper;

  return typeof candidate === 'function' ? (candidate as EyeDropperApi) : undefined;
}

/**
 * Gives the screen's colour picker.
 *
 * @returns Whether it is there, and how to pick.
 */
export function useEyeDropper(): EyeDropper {
  const Api = eyeDropperApi();
  const pick = useCallback(async (): Promise<string | null> => {
    if (Api === undefined) {
      return null;
    }

    try {
      const { sRGBHex } = await new Api().open();

      return sRGBHex;
    } catch {
      // Escape, or the page lost focus: nothing picked, which is not an error.
      return null;
    }
  }, [Api]);

  return { isSupported: Api !== undefined, pick };
}
