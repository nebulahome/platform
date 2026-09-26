/**
 * The size an element is given, as the browser lays it out.
 *
 * For a drawing that composes itself to the room it has rather than scaling a fixed picture down:
 * the energy card's house fills its card while its figures stay the size text is read at.
 * Measured before paint and again whenever the element changes size; zero until then, and where
 * the browser cannot say - a test's DOM lays nothing out - so a caller keeps a size of its own for
 * that.
 */
import { useLayoutEffect, useRef, useState, type RefObject } from 'react';

/** A size, in CSS pixels. */
export type ElementSize = { readonly width: number; readonly height: number };

/**
 * Measures an element.
 *
 * @returns The ref to put on the element, and its size - zero until it has been laid out.
 */
export function useElementSize<T extends Element>(): {
  readonly ref: RefObject<T | null>;
  readonly size: ElementSize;
} {
  const ref = useRef<T>(null);
  const [size, setSize] = useState<ElementSize>({ width: 0, height: 0 });

  // The size is the browser's to decide; the drawing is composed from it.
  useLayoutEffect(() => {
    const element = ref.current;

    if (element === null) {
      return undefined;
    }

    const { width, height } = element.getBoundingClientRect();

    setSize({ width, height });

    if (typeof ResizeObserver === 'undefined') {
      return undefined;
    }

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];

      if (entry !== undefined) {
        setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
      }
    });

    observer.observe(element);

    return (): void => {
      observer.disconnect();
    };
  }, []);

  return { ref, size };
}
