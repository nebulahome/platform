/**
 * Where an alias's action is edited, the number params of its commands may be formulas
 * (`command.level * 0.6`). The action's editor says so, and which names a formula may read besides
 * entities: the values of the command it answers. An automation says nothing, and its params stay
 * plain values.
 */
import { createContext, useContext, type ReactNode } from 'react';

/** The extra names a formula may read, or null where params take no formula. */
const StepFormulas = createContext<readonly string[] | null>(null);

/**
 * Lets the command params inside take formulas.
 *
 * @param props - The names and what they reach.
 * @param props.names - What a formula may read besides entities: `command.level`.
 * @param props.children - The blocks.
 * @returns The provider.
 */
export function StepFormulasProvider(props: {
  readonly names: readonly string[];
  readonly children: ReactNode;
}) {
  return <StepFormulas.Provider value={props.names}>{props.children}</StepFormulas.Provider>;
}

/**
 * Whether command params take formulas here, and the names they may read.
 *
 * @returns The names, or null where params are plain values.
 */
export function useStepFormulas(): readonly string[] | null {
  return useContext(StepFormulas);
}
