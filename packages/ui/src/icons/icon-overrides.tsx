/**
 * What the catalogue says an interface icon looks like, once it has been asked.
 *
 * Empty until the application fills it after sign-in; until then every icon is the bundled
 * drawing, which is what the catalogue would answer for an icon nobody has changed. A context
 * rather than a store, because the design system has no store and nothing here changes more
 * than once a session.
 */
import { createContext, useContext, type ReactNode } from 'react';

import type { IconFrame, IconNode } from '@nebulahome/contracts';

/** A drawing the catalogue serves for an id. */
export type IconDrawing = {
  readonly node: IconNode;
  readonly frame: IconFrame;
};

/** The catalogue's drawings, by id, for the ids that differ from the bundled ones. */
export type IconOverrides = ReadonlyMap<string, IconDrawing>;

const IconOverridesContext = createContext<IconOverrides>(new Map());

/** What the provider needs. */
export type IconOverridesProviderProps = {
  readonly value: IconOverrides;
  readonly children: ReactNode;
};

/**
 * Makes the catalogue's drawings available to every icon beneath.
 *
 * @param props - The overrides and what they apply to.
 * @returns The provider.
 */
export function IconOverridesProvider(props: IconOverridesProviderProps) {
  const { value, children } = props;

  return <IconOverridesContext.Provider value={value}>{children}</IconOverridesContext.Provider>;
}

/**
 * Reads the catalogue's drawing for an id, when it has one.
 *
 * @param id - The catalogue id.
 * @returns The drawing, or undefined to use the bundled one.
 */
export function useIconOverride(id: string): IconDrawing | undefined {
  return useContext(IconOverridesContext).get(id);
}
