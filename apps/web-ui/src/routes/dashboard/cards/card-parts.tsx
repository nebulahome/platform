/**
 * The pieces every dashboard card is built from.
 *
 * One frame, one heading, one way of writing a reading, so a light and a sensor side by side read
 * as two cards of one page. A card lit by the thing on it - a lamp that is on - takes that thing's
 * own colour at its edge and in a wash rising from one corner; everything else is the plain card
 * face every panel in the interface has.
 */
import { createContext, useContext, type CSSProperties, type ReactNode } from 'react';
import { Link } from 'react-router';

import { cn } from '@nebulahome/ui';

/** How a card's face is drawn. */
export type CardTone = 'plain' | 'faint';

/** What a frame needs. */
export type CardFrameProps = {
  /** What the card is, for a screen reader. */
  readonly label: string;

  /** Plain, or faint for something that is not there to be read. */
  readonly tone?: CardTone;

  /** The colour of the light on it, when something on it is lit. */
  readonly glow?: string | undefined;

  /** Anything extra for the outer element. */
  readonly className?: string;

  /**
   * What a tap on the card does, beside its own controls: open the entity, or switch it. Absent,
   * the card does nothing of its own.
   */
  readonly tap?: CardTap | undefined;

  readonly children: ReactNode;
};

/** What a tap on a card's face does. */
export type CardTap =
  | { readonly kind: 'open'; readonly to: string; readonly label: string }
  | { readonly kind: 'away'; readonly href: string; readonly label: string }
  | { readonly kind: 'press'; readonly onPress: () => void; readonly label: string };

/**
 * The tap of the entity card being drawn, set once by the entity card around its kind so every
 * kind's frame takes it without passing it down.
 */
export const CardTapContext = createContext<CardTap | undefined>(undefined);

/**
 * The glow a lit card is drawn with: 14% of its colour from the top-left, the one place colour is
 * allowed to spread (`entity-wash` in the theme draws it from `--glow`).
 *
 * @param color - The light's colour, any CSS colour.
 * @returns The style.
 */
function glowStyle(color: string): CSSProperties & Record<'--glow', string> {
  return { '--glow': color };
}

/**
 * Renders a card's frame.
 *
 * @param props - See {@link CardFrameProps}.
 * @returns The frame.
 */
export function CardFrame(props: CardFrameProps) {
  const { label, tone = 'plain', glow, className, children } = props;
  const inherited = useContext(CardTapContext);
  const tap = props.tap ?? inherited;
  const face =
    'absolute inset-0 z-0 rounded-card transition-colors duration-150 hover:bg-foreground/[0.025] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary';

  return (
    <article
      aria-label={label}
      className={cn(
        'relative flex h-full min-w-0 flex-col overflow-hidden rounded-card border p-4',
        'transition-[border-color,opacity] duration-200',
        tone === 'plain'
          ? 'border-border bg-surface entity-wash'
          : 'border-dashed border-border-strong bg-surface-raised/60',
        className,
      )}
      /* eslint-disable-next-line react/forbid-dom-props -- the wash is the light's own colour, which
      the palette does not hold (RULES.md 15.3). */
      style={glow === undefined ? undefined : glowStyle(glow)}
    >
      {tap === undefined ? null : tap.kind === 'open' ? (
        <Link to={tap.to} aria-label={tap.label} className={face} />
      ) : tap.kind === 'away' ? (
        <a
          href={tap.href}
          target="_blank"
          rel="noreferrer noopener"
          aria-label={tap.label}
          className={face}
        />
      ) : (
        <button type="button" aria-label={tap.label} className={face} onClick={tap.onPress} />
      )}
      {tap === undefined ? (
        children
      ) : (
        // The face takes the taps the card's own controls do not: everything drawn on it lets them
        // through, its controls keep theirs.
        <div className="pointer-events-none relative z-10 flex min-h-0 grow flex-col [&_a]:pointer-events-auto [&_button]:pointer-events-auto [&_input]:pointer-events-auto [&_select]:pointer-events-auto">
          {children}
        </div>
      )}
    </article>
  );
}
