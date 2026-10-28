/**
 * Pieces the newer brokers' pages share: the signal bars Bluetooth draws a device's signal with
 * and Thread a link's quality, the pulse strip an infrared code is drawn as, a choice card with
 * its radio on the left, a line or a snippet to copy, the tag of a device and the integration
 * it comes from, the mono table head and a section's View all.
 */
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { AppIcon, Button, cn, IconButton } from '@nebulahome/ui';

import { copyText } from '@/lib/clipboard';

/**
 * How many of four bars a signal fills: -60 dBm or better is all four.
 *
 * @param rssi - The signal, in dBm; null when not heard.
 * @returns The bars lit, 0 to 4.
 */
export function rssiBars(rssi: number | null): number {
  if (rssi === null) {
    return 0;
  }

  return rssi >= -60 ? 4 : rssi >= -70 ? 3 : rssi >= -80 ? 2 : rssi >= -90 ? 1 : 0;
}

/**
 * The colour a signal is told in: good, fair or weak.
 *
 * @param lit - The bars lit.
 * @param of - Out of how many.
 * @returns The text class.
 */
export function signalTone(lit: number, of: number): string {
  const share = lit / of;

  return share >= 0.7 ? 'text-success' : share >= 0.45 ? 'text-foreground' : 'text-warning';
}

/**
 * Ascending bars, so many lit: a Bluetooth signal, a Thread link's quality.
 *
 * @param props - How many are lit, of how many, and what they say.
 * @param props.lit - The bars lit.
 * @param props.of - The bars drawn; four when not said.
 * @param props.label - What they say, to a screen reader and on hover.
 * @returns The bars.
 */
export function SignalBars(props: {
  readonly lit: number;
  readonly of?: number;
  readonly label: string;
}) {
  const { lit, of = 4, label } = props;

  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={cn('inline-flex h-3.5 items-end gap-0.5', signalTone(lit, of))}
    >
      {Array.from({ length: of }, (slot, position) => position).map((index) => (
        <span
          key={index}
          className={cn(
            'w-0.75 rounded-[1px]',
            ['h-1', 'h-1.75', 'h-2.5', 'h-3.5'][Math.round(((index + 1) / of) * 4) - 1] ?? 'h-3.5',
            index < lit ? 'bg-current' : 'bg-border-strong',
          )}
        />
      ))}
    </span>
  );
}

/**
 * An infrared code drawn as it is sent: a bar for each mark, a gap for each space, as long as it
 * lasts.
 *
 * @param props - The timings.
 * @param props.pulses - Mark, space, mark… in microseconds.
 * @param props.className - The caller's classes.
 * @returns The strip, decorative: the protocol line says what it is.
 */
export function PulseStrip(props: {
  readonly pulses: readonly number[];
  readonly className?: string;
}) {
  const total = props.pulses.reduce((sum, pulse) => sum + pulse, 0) || 1;
  const marks: { readonly x: number; readonly width: number }[] = [];
  let at = 0;

  // Even entries are marks, drawn up; odd ones spaces, left as the baseline.
  for (const [index, pulse] of props.pulses.entries()) {
    if (index % 2 === 0) {
      marks.push({ x: (at / total) * 1000, width: Math.max((pulse / total) * 1000, 0.8) });
    }

    at += pulse;
  }

  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 1000 24"
      preserveAspectRatio="none"
      className={cn('h-9 w-full rounded-field bg-rail px-2 text-[#f7895c]', props.className)}
    >
      <line x1="0" y1="20" x2="1000" y2="20" stroke="var(--color-border-strong)" strokeWidth="1" />
      {marks.map((mark) => (
        <rect key={mark.x} x={mark.x} y="4" width={mark.width} height="16" fill="currentColor" />
      ))}
    </svg>
  );
}

/**
 * One choice of a list a person picks one of: its radio on the left, then what it is, then
 * anything about it on the right. A choice that cannot be taken is greyed with no radio, its
 * reason on the right.
 *
 * @param props - Whether it is chosen or can be, and what it shows.
 * @param props.isChosen - Whether it is the one picked.
 * @param props.isDisabled - Whether it cannot be picked.
 * @param props.onSelect - Picks it.
 * @param props.children - What it is.
 * @param props.trailing - What is said of it on the right.
 * @param props.className - The caller's classes.
 * @returns The card.
 */
export function ChoiceCard(props: {
  readonly isChosen: boolean;
  readonly isDisabled?: boolean;
  readonly onSelect: () => void;
  readonly children: ReactNode;
  readonly trailing?: ReactNode;
  readonly className?: string;
}) {
  const { isChosen, isDisabled = false, onSelect, children, trailing } = props;

  return (
    <button
      type="button"
      role="radio"
      aria-checked={isChosen}
      disabled={isDisabled}
      onClick={onSelect}
      className={cn(
        'flex w-full items-center gap-3.5 rounded-inner border px-4 py-3 text-left focus-visible:ring-3 focus-visible:ring-primary/25 focus-visible:outline-none',
        isChosen
          ? 'border-primary/70 bg-primary/8 ring-1 ring-primary/30'
          : 'border-border bg-surface hover:border-border-strong',
        isDisabled && 'cursor-default opacity-55 hover:border-border',
        props.className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'flex size-4.5 shrink-0 items-center justify-center rounded-full border-[1.5px]',
          isDisabled ? 'invisible' : isChosen ? 'border-primary' : 'border-foreground-subtle',
        )}
      >
        {isChosen ? <span className="size-2 rounded-full bg-primary" /> : null}
      </span>
      <span className="flex min-w-0 grow items-center gap-3">{children}</span>
      {trailing === undefined ? null : (
        <span className="flex shrink-0 items-center gap-3 text-ui-sm text-foreground-muted">
          {trailing}
        </span>
      )}
    </button>
  );
}

/**
 * A copy button: the text is always on screen beside it, so a clipboard that refuses costs only
 * selecting it by hand.
 *
 * @param props - What it copies, and how it is labelled.
 * @param props.value - The text.
 * @param props.label - What the button says; Copy when not said.
 * @param props.isCompact - A small ghost button, for a line.
 * @returns The button.
 */
export function CopyButton(props: {
  readonly value: string;
  readonly label?: string;
  readonly isCompact?: boolean;
}) {
  const { t } = useTranslation();
  const [isCopied, setCopied] = useState(false);

  /** Puts the text on the clipboard. */
  const copy = (): void => {
    void copyText(props.value).then(setCopied);
  };

  if (props.isCompact === true) {
    return (
      <IconButton
        label={isCopied ? t('brokers.parts.copied', 'Copied') : t('brokers.parts.copy', 'Copy')}
        onClick={copy}
      >
        <AppIcon id={isCopied ? 'check' : 'copy'} size={14} />
      </IconButton>
    );
  }

  return (
    <Button variant="ghost" size="compact" onClick={copy}>
      <AppIcon id={isCopied ? 'check' : 'copy'} size={14} />
      {isCopied
        ? t('brokers.parts.copied', 'Copied')
        : (props.label ?? t('brokers.parts.copy', 'Copy'))}
    </Button>
  );
}

/**
 * A snippet to paste elsewhere: a compose file's lines, a host setting. Mono on the rail, with
 * its copy button in its corner.
 *
 * @param props - The text.
 * @param props.code - It, as it is pasted.
 * @returns The block.
 */
export function Snippet(props: { readonly code: string }) {
  return (
    <div className="relative rounded-inner border border-border bg-rail">
      <pre className="overflow-x-auto px-4 py-3.5 pr-24 font-mono text-mono-caption leading-relaxed text-foreground">
        {props.code}
      </pre>
      <span className="absolute top-2 right-2">
        <CopyButton value={props.code} />
      </span>
    </div>
  );
}

/**
 * A device as a small tag: the first letter of the integration it comes from, then its name.
 *
 * @param props - The device and its integration.
 * @param props.name - The device's name.
 * @param props.vendorName - The integration's name; the device's own initial when absent.
 * @param props.className - The caller's classes.
 * @returns The tag.
 */
export function DeviceTag(props: {
  readonly name: string;
  readonly vendorName?: string | null | undefined;
  readonly className?: string;
}) {
  const letter = (props.vendorName ?? props.name).slice(0, 1).toUpperCase();

  return (
    <span
      className={cn(
        'inline-flex h-6.5 max-w-full min-w-0 items-center gap-1.5 rounded-pill border border-border-strong bg-surface pr-2.5 pl-1 text-ui-sm whitespace-nowrap text-foreground',
        props.className,
      )}
    >
      <span className="flex size-4.5 shrink-0 items-center justify-center rounded-chip bg-primary/16 font-mono text-[10px] text-primary">
        {letter}
      </span>
      <span className="truncate">{props.name}</span>
    </span>
  );
}

/** A table's head cell: mono, upper case, subtle, as Modbus › Devices draws them. */
export const HEAD_CELL =
  'py-3.5 pr-4 font-mono text-label font-normal text-foreground-subtle uppercase';

/** A table: one card, its rows split by lines, scrolled sideways when narrow. */
export const TABLE_FRAME = 'overflow-x-auto rounded-card border border-border bg-surface';

/**
 * A section's way to the tab that lists all of it.
 *
 * @param props - Where it goes.
 * @param props.onSelect - Opens the tab.
 * @returns The button.
 */
export function ViewAll(props: { readonly onSelect: () => void }) {
  const { t } = useTranslation();

  return (
    <Button variant="bare" size="compact" onClick={props.onSelect}>
      {t('brokers.parts.viewAll', 'View all')}
      <AppIcon id="chevron-right" size={14} />
    </Button>
  );
}

/**
 * A small mono count beside a name: "12 buttons".
 *
 * @param props - The words.
 * @param props.children - What it says.
 * @returns The tag.
 */
export function CountTag(props: { readonly children: ReactNode }) {
  return (
    <span className="rounded-pill bg-surface-raised px-2 py-px font-mono text-mono-caption whitespace-nowrap text-foreground-muted">
      {props.children}
    </span>
  );
}

/**
 * A chip naming what something can do: IR, RF 433, Receives, Listens only.
 *
 * @param props - The words.
 * @param props.children - What it says.
 * @returns The chip.
 */
export function CapabilityChip(props: { readonly children: ReactNode }) {
  return (
    <span className="inline-flex h-5.5 items-center rounded-pill border border-border-strong px-2 text-caption whitespace-nowrap text-foreground-muted">
      {props.children}
    </span>
  );
}

/**
 * A broker's own empty state, small and in place: a dashed card with its mark, what is missing,
 * how to give it, and the way there. The house's large empty state is for a whole page.
 *
 * @param props - What it says.
 * @param props.mark - The broker's mark, or a glyph.
 * @param props.title - What is missing.
 * @param props.children - How to give it.
 * @param props.action - The way there.
 * @returns The card.
 */
export function BrokerEmpty(props: {
  readonly mark: ReactNode;
  readonly title: string;
  readonly children: ReactNode;
  readonly action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-card border border-dashed border-border-strong px-6 py-11 text-center">
      <span className="mb-1 flex size-16 items-center justify-center rounded-inner border border-border-strong bg-surface-raised">
        {props.mark}
      </span>
      <span className="text-title font-medium text-foreground">{props.title}</span>
      <span className="max-w-120 text-ui leading-normal text-foreground-muted">
        {props.children}
      </span>
      {props.action === undefined ? null : <span className="mt-1">{props.action}</span>}
    </div>
  );
}
