/**
 * A button that acts only when it is held: unlocking a door.
 *
 * Some actions are worth a second of somebody's time: a lock opened by a tap in a pocket, or by
 * a child at the dashboard, is a door open. Held, the button fills from the left over the hold;
 * let go early and it empties and nothing happens. The keyboard holds it with Space or Enter.
 * What it says while held tells the person to keep holding, so the wait reads as on purpose.
 *
 * The fill is the one inline style: how far it has got is a number the frame computes.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';

import { cn } from '../lib/cn.js';

/** What the button needs. */
export type HoldButtonProps = {
  /** What it says at rest: "Hold to unlock". */
  readonly children: ReactNode;

  /** What it says while held: "Keep holding…". */
  readonly holdingLabel?: ReactNode;

  /** How long it must be held. */
  readonly durationMs?: number;

  /** Called once it has been held long enough. */
  readonly onConfirm: () => void;

  /** Whether it can be held now. */
  readonly disabled?: boolean;

  /** How it looks: the page's primary, or a ghost one. */
  readonly variant?: 'primary' | 'ghost';

  /** Anything extra for the button. */
  readonly className?: string;
};

/**
 * Renders the button.
 *
 * @param props - See {@link HoldButtonProps}.
 * @returns The button.
 */
export function HoldButton(props: HoldButtonProps) {
  const {
    children,
    holdingLabel = 'Keep holding…',
    durationMs = 1000,
    onConfirm,
    disabled = false,
    variant = 'ghost',
    className,
  } = props;
  const [progress, setProgress] = useState(0);
  const started = useRef<number | null>(null);
  const frame = useRef<number | null>(null);

  /** Stops the hold, without acting. */
  const release = (): void => {
    started.current = null;
    if (frame.current !== null) {
      cancelAnimationFrame(frame.current);
      frame.current = null;
    }
    setProgress(0);
  };

  useEffect(() => release, []);

  /** Starts the hold, unless one is under way. */
  const press = (): void => {
    if (disabled || started.current !== null) {
      return;
    }

    started.current = performance.now();

    /** Moves the fill on, and acts once it is full. */
    const tick = (): void => {
      if (started.current === null) {
        return;
      }

      const done = Math.min(1, (performance.now() - started.current) / durationMs);
      setProgress(done);

      if (done >= 1) {
        release();
        onConfirm();
        return;
      }

      frame.current = requestAnimationFrame(tick);
    };

    frame.current = requestAnimationFrame(tick);
  };

  const isHolding = progress > 0;

  return (
    <button
      type="button"
      disabled={disabled}
      onPointerDown={press}
      onPointerUp={release}
      onPointerLeave={release}
      onPointerCancel={release}
      onKeyDown={(event) => {
        if ((event.key === ' ' || event.key === 'Enter') && !event.repeat) {
          event.preventDefault();
          press();
        }
      }}
      onKeyUp={(event) => {
        if (event.key === ' ' || event.key === 'Enter') {
          release();
        }
      }}
      onBlur={release}
      className={cn(
        'press relative inline-flex h-control shrink-0 items-center justify-center overflow-hidden rounded-pill border px-4',
        'text-ui font-medium whitespace-nowrap select-none disabled:cursor-not-allowed disabled:opacity-50',
        variant === 'primary'
          ? 'border-transparent bg-primary text-primary-foreground'
          : 'border-border-strong bg-surface-raised text-foreground',
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'absolute inset-y-0 left-0',
          variant === 'primary' ? 'bg-primary-hover' : 'bg-primary-soft',
        )}
        /* eslint-disable-next-line react/forbid-dom-props -- the fill's width is how far the hold got. */
        style={{ width: `${String(progress * 100)}%` }}
      />
      <span className="relative">{isHolding ? holdingLabel : children}</span>
    </button>
  );
}
