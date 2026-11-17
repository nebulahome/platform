/**
 * One row of the command palette (board N-Command-Palette-Rows): one line, 48px - what it is,
 * where it is, how it is now. The active row also carries its second action as a button, left of
 * the state so the state never moves, and the Enter mark, whose place every row keeps.
 *
 * An entity's chip and state are live: on, the chip takes the entity's own colour; unavailable,
 * it goes quiet and the state says so - never a stale value.
 */
import { useCallback, useState, type CSSProperties, type Ref } from 'react';

import type { IconView } from '@nebulahome/contracts';
import { AppIcon, cn } from '@nebulahome/ui';

import { markMatch } from '@/lib/mark-match';
import { capabilityStateOf } from '@/library/entity-control';
import { entityKindOf } from '@/library/entity-kind';
import { readingOf } from '@/library/entity-reading';
import { isActiveState } from '@/library/history-series';
import { useLive } from '@/live/live-store';
import { PaletteActionButton } from '@/palette/palette-action-button';
import { PaletteGlyph } from '@/palette/palette-glyph';
import { PaletteQuickAction } from '@/palette/palette-quick-action';
import type { PaletteItem } from '@/palette/palette-types';
import { EntityStateSummary } from '@/routes/library/entity-state-summary';
import { TONE_CLASSES } from '@/routes/library/entity-tile';

/** A word that matched: brighter and heavier than the text around it, no box behind it. */
const MARK = 'bg-transparent font-medium text-foreground';

/**
 * Where a row stands among those arriving as the palette opens (`palette-row` in the theme).
 *
 * @param place - Its place, from 0.
 * @returns The style.
 */
function arrivalStyle(place: number): CSSProperties & Record<'--palette-i', number> {
  return { '--palette-i': place };
}

/** What a row needs. */
export type PaletteRowProps = {
  readonly item: PaletteItem;

  /** Its id in the list, for the field's `aria-activedescendant`. */
  readonly optionId: string;

  /** The query's words, folded, to mark. */
  readonly words: readonly string[];
  readonly icons: ReadonlyMap<string, IconView>;
  readonly isActive: boolean;

  /** Whether it is the scene just applied: the Enter mark becomes a check. */
  readonly isApplied: boolean;

  /** Whether its kind goes before its second text, in a group of mixed kinds (Recent). */
  readonly hasKind: boolean;

  /** Its place among the rows arriving as the palette opens; null once it has opened. */
  readonly arrival: number | null;

  /** The second action's button, for Tab to press. */
  readonly buttonRef: Ref<HTMLButtonElement>;

  /** The pointer is over it. */
  readonly onPoint: () => void;

  /** It was clicked: Enter. */
  readonly onChoose: () => void;

  /** Its button was pressed: Tab. */
  readonly onSecondary: () => void;
};

/**
 * Renders a row.
 *
 * @param props - See {@link PaletteRowProps}.
 * @returns The row.
 */
export function PaletteRow(props: PaletteRowProps) {
  const { item, optionId, words, icons, isActive, isApplied, hasKind, arrival, buttonRef } = props;
  const { entity } = item;
  const live = useLive((state) =>
    entity === undefined ? undefined : state.readings[entity.entityId],
  );
  const capability = entity === undefined ? null : capabilityStateOf(entity, live);
  const reading = entity === undefined ? null : readingOf(entity, live);
  const isOn = capability !== null && isActiveState(capability) === true;
  const isUnavailable = reading !== null && !reading.isAvailable;
  const [isShaking, setShaking] = useState(false);
  // Stable, so the quick action shakes the row once per failure, not once per render.
  const shake = useCallback(() => {
    setShaking(true);
  }, []);

  // A state that changes while the row is shown swells the chip and brings the new words in.
  const [seen, setSeen] = useState(reading?.text);
  const [changes, setChanges] = useState(0);

  if (reading !== null && seen !== reading.text) {
    setSeen(reading.text);
    setChanges(changes + 1);
  }

  const isLogo = item.icon.kind === 'vendor' || item.icon.kind === 'package';
  const elsewhere = words.filter((word) => !item.foldedTitle.includes(word));
  const secondary =
    hasKind && item.kindLabel !== undefined
      ? [item.kindLabel, item.secondary].filter(Boolean).join(' · ')
      : item.secondary;
  const action = item.secondaryAction;

  return (
    // The field drives the list (combobox): the keys are its, the pointer is this.
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events -- see above
    <div
      id={optionId}
      role="option"
      aria-selected={isActive}
      tabIndex={-1}
      onPointerDown={(event) => {
        // The field keeps the focus.
        event.preventDefault();
      }}
      onPointerMove={isActive ? undefined : props.onPoint}
      onClick={props.onChoose}
      onAnimationEnd={() => {
        setShaking(false);
      }}
      className={cn(
        'relative flex h-12 shrink-0 cursor-pointer items-center gap-3.5 rounded-inner pr-3.5 pl-2.5',
        arrival !== null && 'palette-row',
        isShaking && 'palette-shake',
      )}
      /* eslint-disable-next-line react/forbid-dom-props -- each row arrives a little after the one
         above it, by its place: a number no class can carry (RULES.md 15.3). */
      style={arrival === null ? undefined : arrivalStyle(arrival)}
    >
      <span
        key={changes}
        className={cn(
          'flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-full transition-colors duration-100',
          isLogo
            ? undefined
            : isUnavailable
              ? 'bg-foreground/4 text-foreground/30'
              : isOn && entity !== undefined
                ? TONE_CLASSES[entityKindOf(entity).tone]
                : isActive
                  ? 'bg-primary/20 text-primary'
                  : 'bg-foreground/7 text-foreground/60',
          changes > 0 && 'palette-pop',
        )}
      >
        <PaletteGlyph icon={item.icon} icons={icons} />
      </span>

      <span className="flex min-w-0 grow items-baseline gap-2.5 overflow-hidden whitespace-nowrap">
        <span
          translate={item.isName ? 'no' : undefined}
          className={cn(
            'max-w-full shrink-0 truncate text-title',
            isUnavailable ? 'text-foreground/45' : 'text-foreground/80',
          )}
        >
          {markMatch(item.title, words, MARK)}
        </span>
        {secondary === '' ? null : (
          <span
            translate={item.isName && !hasKind ? 'no' : undefined}
            className="min-w-0 truncate text-caption text-foreground/45"
          >
            {markMatch(secondary, elsewhere, MARK)}
          </span>
        )}
      </span>

      {isActive && action !== undefined ? (
        action.command.type === 'power' ? (
          <PaletteQuickAction
            entity={action.command.entity}
            buttonRef={buttonRef}
            onFailed={shake}
          />
        ) : (
          <PaletteActionButton
            label={action.hint}
            buttonRef={buttonRef}
            onPress={props.onSecondary}
          />
        )
      ) : null}

      {item.warning === undefined ? null : (
        <AppIcon
          id="triangle-alert"
          size={14}
          className="shrink-0 text-warning"
          aria-label={item.warning}
        />
      )}

      {reading !== null && capability !== null ? (
        <span
          key={reading.text}
          className={cn('max-w-62.5 truncate', changes > 0 && 'palette-tick')}
        >
          <EntityStateSummary reading={reading} state={capability} isCompact />
        </span>
      ) : item.state === undefined ? null : (
        <span
          className={cn(
            'font-mono text-mono-caption whitespace-nowrap tabular',
            item.state.isQuiet ? 'text-foreground/45' : 'text-foreground',
          )}
        >
          {item.state.text}
        </span>
      )}

      <span
        aria-hidden="true"
        className={cn(
          'flex shrink-0 text-primary transition-opacity duration-100',
          isActive || isApplied ? 'opacity-100' : 'opacity-0',
        )}
      >
        {isApplied ? (
          <AppIcon id="check" size={15} className="palette-check" />
        ) : (
          <AppIcon id="corner-down-left" size={15} />
        )}
      </span>
    </div>
  );
}
