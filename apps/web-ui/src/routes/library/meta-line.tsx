/**
 * The facts line and the figures of a page about one thing, as the package and compose pages
 * still draw them: the id, the version and the rest with a dot between each, and a figure with
 * its noun under it.
 */
import type { ReactNode } from 'react';

/**
 * A figure with its noun under it.
 *
 * @param props - The figure and the noun.
 * @param props.value - The figure.
 * @param props.noun - What is being counted, pluralised by the caller.
 * @returns The stat.
 */
export function Stat(props: { readonly value: number; readonly noun: string }) {
  const { value, noun } = props;

  return (
    <span className="flex flex-col items-end gap-0.5 pl-5">
      <span className="font-mono text-reading-sm font-medium text-foreground tabular">{value}</span>
      <span className="text-caption text-foreground-subtle">{noun}</span>
    </span>
  );
}

/**
 * The line under the vendor's name - id, version, when it was set up, its site - with a dot
 * between each pair, and nothing after the last.
 *
 * @param props - The parts, in order; a part that is not there is left out.
 * @param props.parts - What to show.
 * @returns The line.
 */
export function MetaLine(props: { readonly parts: readonly (ReactNode | null)[] }) {
  const present = props.parts.filter((part) => part !== null);

  return (
    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-caption text-foreground-subtle">
      {present.map((part, index) => (
        // Position is identity here: the parts are a fixed, ordered handful.
        // eslint-disable-next-line react/no-array-index-key
        <span key={index} className="flex items-center gap-x-2.5">
          {index === 0 ? null : (
            <span aria-hidden="true" className="text-foreground-subtle">
              ·
            </span>
          )}
          {part}
        </span>
      ))}
    </div>
  );
}
