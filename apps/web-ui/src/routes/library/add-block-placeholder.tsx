/**
 * The dashed card at the bottom of a branch that opens the block picker.
 *
 * Same face as the "New scene" tile on the scenes page: a panel border that is dashed rather
 * than solid, so it reads as a place to put something rather than as something already there.
 */
import { cn } from '@nebula-home/ui';

/** What the placeholder needs. */
export type AddBlockPlaceholderProps = {
  /** Called when the card is activated. */
  readonly onClick: () => void;

  /** Optional label; defaults to "Add block". */
  readonly label?: string;
};

/**
 * Renders the dashed Add block card.
 *
 * @param props - See {@link AddBlockPlaceholderProps}.
 * @returns The button.
 */
export function AddBlockPlaceholder(props: AddBlockPlaceholderProps) {
  const { onClick, label = 'Add block' } = props;

  return (
    <button
      type="button"
      className={cn(
        'flex w-full flex-col items-start justify-center gap-0.5 rounded-panel border border-dashed border-border-strong px-4 py-3.5 text-left',
        'text-foreground-muted transition-colors hover:border-primary/40 hover:text-foreground',
        'focus-visible:ring-3 focus-visible:ring-primary/25 focus-visible:outline-none',
      )}
      onClick={onClick}
    >
      <span className="text-ui font-medium text-foreground">{label}</span>
    </button>
  );
}
