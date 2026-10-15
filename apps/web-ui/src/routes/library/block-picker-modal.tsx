/**
 * Choosing which kind of block to add (board N-Automation-Pick).
 *
 * A search over the top, then the blocks in groups - Actions and Control for Then - two to a row,
 * each with its glyph, its name and what it does. The arrow keys move through them and Enter takes
 * the one that is lit; Escape, the cross or a click outside closes it. A block the engine cannot
 * run yet stays in the list, dimmed, saying why, so nobody wonders where it went.
 */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { AppIcon, cn, laneClass, Modal } from '@nebulahome/ui';

import type { EditorChoice, EditorChoiceGroup } from '@/routes/library/editor-choices';

/** What the picker needs. */
export type BlockPickerModalProps = {
  /** Whether it is open. */
  readonly isOpen: boolean;

  /** Called when the person dismisses it. */
  readonly onClose: () => void;

  /** Heading. */
  readonly title: string;

  /** Line under the heading. */
  readonly description?: string;

  /** Grouped choices to offer. */
  readonly groups: readonly EditorChoiceGroup[];

  /** Called with the kind picked. */
  readonly onPick: (type: string) => void;
};

/**
 * Whether a choice matches what was typed.
 *
 * @param choice - The choice.
 * @param needle - What was typed, lower case.
 * @returns True when its name, kind or line has it.
 */
function matches(choice: EditorChoice, needle: string): boolean {
  return (
    choice.label.toLowerCase().includes(needle) ||
    choice.value.toLowerCase().includes(needle) ||
    (choice.description?.toLowerCase().includes(needle) ?? false)
  );
}

/**
 * Renders the block picker.
 *
 * @param props - See {@link BlockPickerModalProps}.
 * @returns The dialog.
 */
export function BlockPickerModal(props: BlockPickerModalProps) {
  const { t } = useTranslation();

  const { isOpen, onClose, title, description, groups, onPick } = props;
  const [search, setSearch] = useState('');
  const [active, setActive] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  const searchBox = useRef<HTMLInputElement>(null);

  // The dialog gives focus to its first control when it opens - the close button. A picker is
  // there to be typed into, so the search takes it back, once the dialog has opened.
  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    const frame = requestAnimationFrame(() => {
      searchBox.current?.focus();
    });

    return () => {
      cancelAnimationFrame(frame);
    };
  }, [isOpen]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();

    return groups
      .map((group) => ({
        ...group,
        choices:
          needle === '' ? group.choices : group.choices.filter((choice) => matches(choice, needle)),
      }))
      .filter((group) => group.choices.length > 0);
  }, [groups, search]);

  // The choices in reading order, the ones that can be taken only: what the arrows move through.
  const reachable = useMemo(
    () =>
      filtered
        .flatMap((group) => group.choices)
        .filter((choice) => choice.unavailable === undefined),
    [filtered],
  );
  const activeValue = reachable[Math.min(active, reachable.length - 1)]?.value;

  /** Closes and forgets what was typed. */
  const close = (): void => {
    setSearch('');
    setActive(0);
    onClose();
  };

  /**
   * Takes a choice.
   *
   * @param value - The kind.
   */
  const pick = (value: string): void => {
    setSearch('');
    setActive(0);
    onPick(value);
  };

  /**
   * Moves through the choices with the arrows, two to a row; Enter takes the lit one.
   *
   * @param event - The key press.
   */
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    const steps: Readonly<Record<string, number>> = {
      ArrowDown: 2,
      ArrowUp: -2,
      ArrowRight: 1,
      ArrowLeft: -1,
    };
    const step = steps[event.key];

    if (step !== undefined && reachable.length > 0) {
      event.preventDefault();

      const next = Math.min(Math.max(active + step, 0), reachable.length - 1);

      setActive(next);
      list.current
        ?.querySelector(`[data-choice="${reachable[next]?.value ?? ''}"]`)
        ?.scrollIntoView({ block: 'nearest' });
    }

    if (event.key === 'Enter' && activeValue !== undefined) {
      event.preventDefault();
      pick(activeValue);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={close}
      title={title}
      description={description}
      size="picker"
      hasCloseButton
    >
      <div className="flex flex-col gap-5">
        <label className="flex h-11.5 items-center gap-2.5 rounded-tile border border-primary bg-surface-raised px-3.5 shadow-focus">
          <AppIcon id="search" size={16} className="shrink-0 text-foreground-subtle" />
          <span className="sr-only">
            {t('library.blockPickerModal.searchBlocks', 'Search blocks')}
          </span>
          <input
            ref={searchBox}
            type="search"
            placeholder={t('library.blockPickerModal.searchBlocks2', 'Search blocks…')}
            value={search}
            aria-activedescendant={activeValue === undefined ? undefined : `choice-${activeValue}`}
            aria-controls="block-choices"
            onKeyDown={onKeyDown}
            onChange={(event) => {
              setSearch(event.target.value);
              setActive(0);
            }}
            className="min-w-0 grow bg-transparent text-ui text-foreground placeholder:text-foreground-subtle focus:outline-none [&::-webkit-search-cancel-button]:hidden"
          />
          <kbd className="rounded-check border border-border-strong px-1.5 font-mono text-mono-caption text-foreground-subtle">
            {t('library.blockPickerModal.esc', 'Esc')}
          </kbd>
        </label>

        {filtered.length === 0 ? (
          <p className="py-6 text-center text-ui text-foreground-muted">
            {t('library.blockPickerModal.nothingMatches', 'Nothing matches.')}
          </p>
        ) : (
          <div
            ref={list}
            id="block-choices"
            role="listbox"
            aria-label={title}
            className="-mx-1 flex max-h-[min(70vh,40rem)] flex-col gap-5 overflow-y-auto px-1"
          >
            {filtered.map((group) => (
              <section
                key={group.title}
                className={cn(laneClass(group.lane), 'flex flex-col gap-2')}
              >
                <h3 className="font-mono text-label tracking-[0.08em] text-[var(--lane)] uppercase">
                  {group.title}
                </h3>
                <div className="grid gap-1.5 sm:grid-cols-2">
                  {group.choices.map((choice) => {
                    const isActive = choice.value === activeValue;
                    const isUnavailable = choice.unavailable !== undefined;

                    return (
                      <button
                        key={choice.value}
                        id={`choice-${choice.value}`}
                        type="button"
                        role="option"
                        aria-selected={isActive}
                        aria-disabled={isUnavailable}
                        data-choice={choice.value}
                        title={choice.unavailable}
                        onMouseEnter={() => {
                          const index = reachable.findIndex(
                            (entry) => entry.value === choice.value,
                          );

                          if (index >= 0) {
                            setActive(index);
                          }
                        }}
                        onClick={() => {
                          if (!isUnavailable) {
                            pick(choice.value);
                          }
                        }}
                        className={cn(
                          'flex items-center gap-3 rounded-inner border px-3 py-2.5 text-left transition-colors',
                          'focus-visible:ring-3 focus-visible:ring-primary/25 focus-visible:outline-none',
                          isActive
                            ? 'border-primary bg-primary/10'
                            : 'border-transparent hover:bg-surface-raised',
                          isUnavailable ? 'cursor-not-allowed opacity-55' : 'cursor-pointer',
                        )}
                      >
                        <span className="flex size-8.5 shrink-0 items-center justify-center rounded-field bg-surface-raised text-[var(--lane)]">
                          <AppIcon id={choice.glyph} size={16} />
                        </span>
                        <span className="flex min-w-0 flex-col">
                          <span className="text-ui font-medium text-foreground">
                            {choice.label}
                          </span>
                          <span className="truncate text-caption text-foreground-subtle">
                            {choice.unavailable ?? choice.description}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}
