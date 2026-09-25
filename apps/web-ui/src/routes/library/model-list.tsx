/**
 * The models a device can be added as: a card of its own beside the dialog, searched and picked.
 *
 * A list rather than a dropdown: a vendor ships a dozen models, and the owner adding one is
 * reading the name off a box - a list shows the names at once, keeps the pick in sight while the
 * form beside it is filled in, and a search narrows a long one to the few that match what is
 * printed on the box. When the vendor's models come from more than one driver they are grouped
 * under the driver's name, so a relay and a dimmer of the same family are told apart before either
 * is picked.
 *
 * One stop in the tab order, like any listbox: the arrows move the pick up and down, Home and End
 * go to either end, and the pick is the option in focus - there is nothing to confirm. From the
 * search, the down arrow goes into the list.
 */
import { useId, useRef, useState, type KeyboardEvent } from 'react';

import type { IntegrationVendorView, ModelChoice } from '@nebula-home/contracts';
import { cn } from '@nebula-home/ui';

import { matchesQuery } from '@/lib/search-text';
import { SearchField } from '@/routes/library/search-field';

/** From how many models the list offers a search: below it, the list is read at a glance. */
export const MODEL_SEARCH_FROM = 6;

/** What the list needs. */
export type ModelListProps = {
  /** Every model the vendor offers, in the bundle's order. */
  readonly choices: readonly ModelChoice[];

  /** The one picked, if any. */
  readonly value: ModelChoice | undefined;

  /** The vendor, for the drivers' names the groups are headed by. */
  readonly vendor: Pick<IntegrationVendorView, 'drivers'> | undefined;

  /** Called with the model picked. */
  readonly onPick: (choice: ModelChoice) => void;

  /** Whether the list takes no pick. */
  readonly disabled?: boolean;
};

/**
 * Whether two choices are the same model of the same driver.
 *
 * @param a - One.
 * @param b - The other.
 * @returns True when they name the same thing.
 */
function isSame(a: ModelChoice | undefined, b: ModelChoice): boolean {
  return a?.kind === b.kind && a.model === b.model;
}

/**
 * Groups the choices by their driver, keeping the bundle's order within and between the groups.
 *
 * @param choices - The choices.
 * @returns One group per driver, in the order each driver first appears.
 */
function byDriver(choices: readonly ModelChoice[]): { kind: string; choices: ModelChoice[] }[] {
  const groups: { kind: string; choices: ModelChoice[] }[] = [];

  for (const choice of choices) {
    const group = groups.find((each) => each.kind === choice.kind);

    if (group === undefined) {
      groups.push({ kind: choice.kind, choices: [choice] });
    } else {
      group.choices.push(choice);
    }
  }

  return groups;
}

/**
 * Renders the card's content: its heading, the search, and the list.
 *
 * @param props - See {@link ModelListProps}.
 * @returns The content, to sit in the dialog's side card.
 */
export function ModelList(props: ModelListProps) {
  const { choices, value, vendor, onPick, disabled = false } = props;
  const id = useId();
  const listRef = useRef<HTMLDivElement>(null);
  const [search, setSearch] = useState('');

  /**
   * The name of a choice's driver.
   *
   * @param kind - The driver, as `vendor/driver`.
   * @returns Its name, or the kind while the catalogue says nothing of it.
   */
  const driverName = (kind: string): string =>
    vendor?.drivers.find((driver) => driver.id === kind)?.name ?? kind;

  const shown = choices.filter((choice) =>
    matchesQuery([choice.model, driverName(choice.kind)], search),
  );
  const groups = byDriver(shown);
  const isGrouped = byDriver(choices).length > 1;
  const pickedIndex = shown.findIndex((choice) => isSame(value, choice));

  /**
   * Picks the shown choice at a position and moves focus to it.
   *
   * @param index - Where in what is shown.
   */
  const pickAt = (index: number): void => {
    const next = shown[Math.min(Math.max(index, 0), shown.length - 1)];

    if (next === undefined) {
      return;
    }

    onPick(next);
    listRef.current
      ?.querySelector<HTMLElement>(`[data-option="${String(shown.indexOf(next))}"]`)
      ?.focus();
  };

  /**
   * Moves the pick with the keys a listbox answers to.
   *
   * @param event - The key pressed.
   */
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (disabled) {
      return;
    }

    const from = pickedIndex === -1 ? 0 : pickedIndex;
    const moves: Readonly<Record<string, number>> = {
      ArrowDown: from + (pickedIndex === -1 ? 0 : 1),
      ArrowUp: from - 1,
      Home: 0,
      End: shown.length - 1,
    };
    const target = moves[event.key];

    if (target !== undefined) {
      event.preventDefault();
      pickAt(target);
    }
  };

  return (
    <>
      <div className="flex flex-col gap-3 border-b border-border-soft p-4">
        <div className="flex items-baseline justify-between gap-2">
          <h3 id={`${id}-label`} className="text-title font-semibold">
            Model
          </h3>
          <span className="text-caption text-foreground-subtle tabular">
            {shown.length === choices.length
              ? `${String(choices.length)} models`
              : `${String(shown.length)} of ${String(choices.length)}`}
          </span>
        </div>
        {choices.length >= MODEL_SEARCH_FROM ? (
          // Arrow down from the box goes into the list, the way a search above a list is read. The
          // group only hears the key on its way up from the search box, which is the control.
          // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- see above
          <div
            role="group"
            aria-label="Model search"
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown' && shown.length > 0) {
                event.preventDefault();
                pickAt(pickedIndex === -1 ? 0 : pickedIndex);
              }
            }}
          >
            <SearchField
              label="Search models"
              placeholder="Search models…"
              value={search}
              onChange={setSearch}
              className="w-full lg:w-full"
            />
          </div>
        ) : null}
      </div>

      <div
        ref={listRef}
        role="listbox"
        aria-labelledby={`${id}-label`}
        aria-disabled={disabled}
        // Focus rests on the picked option, not on the list: -1 keeps the list itself out of the
        // tab order while letting it take the keys its options pass up.
        tabIndex={-1}
        onKeyDown={onKeyDown}
        className="flex min-h-0 grow flex-col gap-0.5 overflow-y-auto p-2"
      >
        {shown.length === 0 ? (
          <p className="px-2.5 py-3 text-ui text-foreground-subtle">
            No model matches “{search.trim()}”.
          </p>
        ) : null}
        {groups.map((group) => (
          <div
            key={group.kind}
            role="group"
            aria-label={isGrouped ? driverName(group.kind) : undefined}
          >
            {isGrouped ? (
              <div
                aria-hidden="true"
                className="px-2.5 pt-2.5 pb-1 text-label text-foreground-subtle uppercase"
              >
                {driverName(group.kind)}
              </div>
            ) : null}
            {group.choices.map((choice) => {
              const index = shown.indexOf(choice);
              const isPicked = isSame(value, choice);
              const isTabStop = isPicked || (pickedIndex === -1 && index === 0);

              return (
                <div
                  key={`${choice.kind}\u0000${choice.model}`}
                  role="option"
                  aria-selected={isPicked}
                  data-option={index}
                  tabIndex={isTabStop && !disabled ? 0 : -1}
                  onClick={() => {
                    if (!disabled) {
                      onPick(choice);
                    }
                  }}
                  onKeyDown={(event) => {
                    if (!disabled && (event.key === 'Enter' || event.key === ' ')) {
                      event.preventDefault();
                      onPick(choice);
                    }
                  }}
                  className={cn(
                    'flex h-9 cursor-pointer items-center justify-between gap-2 rounded-chip px-2.5 text-ui',
                    'focus-visible:ring-3 focus-visible:ring-primary/25 focus-visible:outline-none',
                    isPicked
                      ? 'bg-primary/13 font-medium text-foreground'
                      : 'text-foreground-muted hover:bg-surface-raised/70 hover:text-foreground',
                    disabled ? 'cursor-not-allowed opacity-60' : null,
                  )}
                >
                  <span className="truncate">{choice.model}</span>
                  {isPicked ? (
                    <span
                      aria-hidden="true"
                      className="size-1.5 shrink-0 rounded-full bg-primary"
                    />
                  ) : null}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </>
  );
}
