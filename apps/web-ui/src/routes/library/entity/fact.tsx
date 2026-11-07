/**
 * One fact in a list of them: what it is, and its value - a term over a definition, in the
 * two columns a facts list lines them up in.
 */
import type { ReactNode } from 'react';

/** What one fact needs. */
export type FactProps = {
  readonly term: string;
  readonly children: ReactNode;
};

/**
 * One line of the list: what it is, and its value.
 *
 * @param props - See {@link FactProps}.
 * @returns The line.
 */
export function Fact(props: FactProps) {
  const { term, children } = props;

  return (
    <div className="grid grid-cols-[7.5rem_minmax(0,1fr)] items-baseline gap-3 border-b border-border px-4 py-2.5 last:border-b-0">
      <dt className="text-caption text-foreground-subtle">{term}</dt>
      <dd className="min-w-0 text-ui break-words text-foreground">{children}</dd>
    </div>
  );
}
