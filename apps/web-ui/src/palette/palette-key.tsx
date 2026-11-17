/**
 * A key, as the command palette writes it: on its rows' buttons and in its keys bar.
 */
import type { ReactNode } from 'react';

/** What a key needs. */
export type PaletteKeyProps = {
  /** The key: a name (`Tab`, `Esc`) or glyphs. */
  readonly children: ReactNode;
};

/**
 * Renders a key.
 *
 * @param props - See {@link PaletteKeyProps}.
 * @returns The key.
 */
export function PaletteKey(props: PaletteKeyProps) {
  return (
    // A key's name is the same in every language.
    <kbd
      translate="no"
      className="inline-flex h-5.5 min-w-5.5 shrink-0 items-center justify-center gap-px rounded-check border border-foreground/14 bg-foreground/7 px-1.75 font-mono text-label leading-none tracking-normal text-foreground/80"
    >
      {props.children}
    </kbd>
  );
}
