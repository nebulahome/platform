/**
 * A button held for a second before it acts, as the canvas draws the lock's and the restart's:
 * a fill grows across it while it is held, and letting go early does nothing. The time it takes
 * is written at its end, so nobody wonders why a press did nothing.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { AppIcon, cn, type UiIconId } from '@nebulahome/ui';

/** What the button needs. */
export type HoldActionProps = {
  /** What it says: "Hold to unlock". */
  readonly children: ReactNode;

  /** Its glyph. */
  readonly icon: UiIconId;

  /** Called once it has been held long enough. */
  readonly onConfirm: () => void;

  /** How long it must be held. */
  readonly durationMs?: number;

  /** Whether it is the main action, filled in a colour: a class, `bg-success text-canvas`. */
  readonly fill?: string;

  /** The colour it fills with while held, as a class: the thing's own colour now. */
  readonly progress?: string;

  /** Its height: 56 alone, 52 in a pair. */
  readonly size?: 'large' | 'medium';

  /** Whether it cannot be used now. */
  readonly disabled?: boolean;

  /** Whether its glyph stands over its words, as in a round button: a restart's. */
  readonly isStacked?: boolean;
};

/**
 * Renders the button.
 *
 * @param props - See {@link HoldActionProps}.
 * @returns The button.
 */
export function HoldAction(props: HoldActionProps) {
  const { t } = useTranslation();
  const {
    children,
    icon,
    onConfirm,
    durationMs = 1000,
    fill,
    progress: progressColour = 'bg-warning/25',
    size = 'medium',
    disabled = false,
    isStacked = false,
  } = props;
  const [progress, setProgress] = useState(0);
  // How many times it went through: each one flashes the button once.
  const [confirmed, setConfirmed] = useState(0);
  const started = useRef<number | null>(null);
  const frame = useRef<number | null>(null);

  /** Stops filling, and empties. */
  const cancel = (): void => {
    started.current = null;

    if (frame.current !== null) {
      cancelAnimationFrame(frame.current);
      frame.current = null;
    }

    setProgress(0);
  };

  /** Starts filling; acts when full. */
  const start = (): void => {
    if (disabled || started.current !== null) {
      return;
    }

    started.current = performance.now();

    /** Grows the fill, frame by frame. */
    const tick = (): void => {
      if (started.current === null) {
        return;
      }

      const done = Math.min(1, (performance.now() - started.current) / durationMs);

      setProgress(done);

      if (done >= 1) {
        cancel();
        setConfirmed((count) => count + 1);
        // A short buzz on a phone: the hold went through.
        if ('vibrate' in navigator) {
          navigator.vibrate(30);
        }

        onConfirm();

        return;
      }

      frame.current = requestAnimationFrame(tick);
    };

    frame.current = requestAnimationFrame(tick);
  };

  // A button taken away mid-hold leaves no frame behind.
  useEffect(
    () => () => {
      if (frame.current !== null) {
        cancelAnimationFrame(frame.current);
      }
    },
    [],
  );

  return (
    <button
      type="button"
      disabled={disabled}
      onPointerDown={start}
      onPointerUp={cancel}
      onPointerLeave={cancel}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          start();
        }
      }}
      onKeyUp={cancel}
      className={cn(
        'press relative inline-flex flex-1 cursor-pointer items-center justify-center gap-2 overflow-hidden border font-medium select-none',
        'transition-[scale,border-color] duration-200 ease-out disabled:cursor-not-allowed disabled:text-foreground-disabled',
        // Held, it sinks a little further for as long as it is held.
        progress > 0 && 'scale-[0.985] border-foreground-subtle',
        size === 'large' ? 'h-14 rounded-panel text-title' : 'h-13 rounded-card text-ui',
        fill ?? 'border-border-strong bg-surface-raised text-foreground',
        fill !== undefined && 'border-transparent',
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'absolute inset-y-0 left-0',
          progressColour,
          // Filled frame by frame while held; let go, it drains back rather than vanishing.
          progress === 0 && 'transition-[width] duration-300 ease-out',
        )}
        // eslint-disable-next-line react/forbid-dom-props -- the fill is how long it has been held
        style={{ width: `${String(progress * 100)}%` }}
      >
        {progress > 0 ? (
          // A brighter edge where the fill is growing.
          <span className="absolute inset-y-0 right-0 w-8 bg-linear-to-r from-transparent to-white/22" />
        ) : null}
      </span>
      {confirmed === 0 ? null : (
        <span
          key={confirmed}
          aria-hidden="true"
          className={cn('entity-flash pointer-events-none absolute inset-0', progressColour)}
        />
      )}
      <span
        className={cn(
          'relative inline-flex items-center',
          isStacked ? 'flex-col gap-2 text-ui' : 'gap-2',
        )}
      >
        <span
          className={cn('flex', progress === 0 && 'transition-[rotate] duration-300 ease-out')}
          // eslint-disable-next-line react/forbid-dom-props -- the glyph turns as the hold fills, a key in a lock
          style={{ rotate: `${String(progress * -14)}deg` }}
        >
          <AppIcon
            id={icon}
            size={isStacked ? 36 : 16}
            className={isStacked ? 'text-current' : undefined}
          />
        </span>
        {children}
        <span
          className={cn(
            'ml-0.5 font-mono text-[11px]',
            fill === undefined ? 'text-foreground-subtle' : 'text-current',
          )}
        >
          {t('entity.sheet.seconds', '{{count}} s', {
            // Counting down while held.
            count: Number((((1 - progress) * durationMs) / 1000).toFixed(progress > 0 ? 1 : 0)),
          })}
        </span>
      </span>
    </button>
  );
}
