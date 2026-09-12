/**
 * A line of explanation at the foot of a {@link Panel}.
 *
 * For the things a person has to be told rather than shown: that a constraint exists, or that a
 * page's settings live in this browser and nowhere else.
 */
import type { ReactNode } from 'react';

/** What a note needs. */
export type PanelNoteProps = {
  /** What the reader should know. */
  readonly children: ReactNode;
};

/**
 * Renders a note at the foot of a panel.
 *
 * @param props - See {@link PanelNoteProps}.
 * @returns The note.
 */
export function PanelNote(props: PanelNoteProps) {
  const { children } = props;

  return (
    <p className="border-t border-border-soft px-4 py-3 text-caption text-foreground-subtle">
      {children}
    </p>
  );
}
