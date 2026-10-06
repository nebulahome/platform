/**
 * The tags on a device or an entity, as a field: chips for what is on it, a box to type in, and
 * a list of what could go on.
 *
 * One control for two dialogs, because a tag means the same thing on both and the way it is
 * put on should be the same too. The box is a combobox in the dropdown's mould - focus stays in
 * the input, the list is named by `aria-activedescendant`, the arrow keys move and Enter
 * chooses - with two things a dropdown does not have: Backspace in an empty box takes the last
 * chip off, and typing a name no tag has offers to make one, colour and all, without leaving
 * the field. Making a tag is a step of its own inside the list - a colour, then a button - so
 * that nothing is created by a keystroke that was meant to search.
 *
 * The list floats the way the dropdown's does, through `useAnchoredPlacement`, for the same
 * reasons; and because focus does enter it for the colour step, it shuts on a pointer press
 * outside both the field and the list rather than on blur alone.
 */
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';

import { TAG_COLORS, type IconView, type TagColor, type TagView } from '@nebulahome/contracts';
import {
  Button,
  ColorSwatches,
  cn,
  FieldShell,
  hostFor,
  TAG_FILL_CLASSES,
  TagChip,
  useAnchoredPlacement,
} from '@nebulahome/ui';

import { toMessage } from '@/lib/error-message';
import { creatableTagName, filterTagChoices } from '@/library/tag-choices';

/** What the field needs. */
export type TagFieldProps = {
  /** What the field is for; `Tags` unless said otherwise. */
  readonly label?: string;

  /** The tags on the row, by id, in order. */
  readonly value: readonly string[];

  /** Called with the whole set as it should now be. */
  readonly onChange: (next: string[]) => void;

  /** Every tag there is, in the order the list should read. */
  readonly tags: readonly TagView[];

  /** The catalogue's icons for the tags, by id; a chip without one draws the tag glyph. */
  readonly icons?: ReadonlyMap<string, IconView> | undefined;

  /** Whether a name no tag has may become one. */
  readonly canCreate: boolean;

  /**
   * Makes a tag.
   *
   * @param name - What was typed.
   * @param color - The colour picked.
   * @returns The tag, once the server has it.
   */
  readonly onCreate: (name: string, color: TagColor) => Promise<TagView>;

  /** A line under the control, for what the label cannot say. */
  readonly hint?: string;

  /** Whether the tags can be changed at all. */
  readonly disabled?: boolean;
};

/** A tag being made: what it will be called, and which colour is picked so far. */
type Draft = {
  readonly name: string;
  readonly color: TagColor;
};

/**
 * The colour a new tag starts with: the first of the palette no tag uses yet, else the first.
 *
 * @param tags - Every tag.
 * @returns A colour.
 */
function freshColor(tags: readonly TagView[]): TagColor {
  const used = new Set(tags.map((tag) => tag.color));

  return TAG_COLORS.find((color) => !used.has(color)) ?? TAG_COLORS[0];
}

/**
 * Renders the field.
 *
 * @param props - See {@link TagFieldProps}.
 * @returns The field, and its list when open.
 */
export function TagField(props: TagFieldProps) {
  const {
    label = 'Tags',
    value,
    onChange,
    tags,
    icons,
    canCreate,
    onCreate,
    hint,
    disabled = false,
  } = props;

  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const listId = useId();
  const { placement, open, close } = useAnchoredPlacement(root);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [isCreating, setCreating] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const isOpen = placement !== null;
  const byId = new Map(tags.map((tag) => [tag.id, tag]));
  const chosen = value.flatMap((id) => {
    const tag = byId.get(id);

    return tag === undefined ? [] : [tag];
  });
  const matches = filterTagChoices(tags, value, query);
  const creatable = canCreate ? creatableTagName(tags, query) : null;
  const choices: readonly (TagView | { readonly create: string })[] = [
    ...matches,
    ...(creatable === null ? [] : [{ create: creatable }]),
  ];

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    /**
     * Shuts the list on a press that lands outside both the field and the list.
     *
     * @param event - The press.
     */
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target instanceof Node ? event.target : null;

      if (
        target !== null &&
        !(root.current?.contains(target) ?? false) &&
        !(list.current?.contains(target) ?? false)
      ) {
        close();
        setDraft(null);
      }
    };

    document.addEventListener('pointerdown', onPointerDown);

    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [isOpen, close]);

  /** Shuts the list and forgets a tag being made. */
  const shut = (): void => {
    close();
    setDraft(null);
    setActiveIndex(0);
  };

  /**
   * Puts a tag on the row.
   *
   * @param id - Which tag.
   */
  const put = (id: string): void => {
    onChange([...value, id]);
    setQuery('');
    setActiveIndex(0);
    input.current?.focus();
  };

  /**
   * Takes a tag off the row.
   *
   * @param id - Which tag.
   */
  const take = (id: string): void => {
    onChange(value.filter((each) => each !== id));
  };

  /**
   * Acts on a choice: a tag goes on, or the making of one begins.
   *
   * @param index - Which choice.
   */
  const choose = (index: number): void => {
    const choice = choices[index];

    if (choice === undefined) {
      return;
    }

    if ('create' in choice) {
      setDraft({ name: choice.create, color: freshColor(tags) });
      setProblem(null);

      return;
    }

    put(choice.id);
  };

  /** Makes the tag being drafted, and puts it on. */
  const create = async (): Promise<void> => {
    if (draft === null) {
      return;
    }

    setCreating(true);
    setProblem(null);

    try {
      const made = await onCreate(draft.name, draft.color);

      setDraft(null);
      put(made.id);
    } catch (error: unknown) {
      setProblem(toMessage(error));
    } finally {
      setCreating(false);
    }
  };

  /**
   * Handles every key the box responds to.
   *
   * @param event - The key press.
   */
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Escape') {
      if (isOpen) {
        // Kept from bubbling: a dialog listens for Escape on the document, and one press should
        // shut the list somebody is looking at rather than the form underneath it.
        event.stopPropagation();
        shut();
      }

      return;
    }

    if (event.key === 'Tab') {
      // Not prevented: Tab is how somebody leaves, and a field that swallows it is a trap. It
      // may land in the list when a tag is being made, which is where it should go.
      if (draft === null) {
        shut();
      }

      return;
    }

    if (event.key === 'Backspace' && query === '' && value.length > 0) {
      take(value[value.length - 1] ?? '');

      return;
    }

    if (!isOpen) {
      if (['ArrowDown', 'ArrowUp', 'Enter'].includes(event.key)) {
        event.preventDefault();
        open();
      }

      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      choose(activeIndex);

      return;
    }

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();

      if (choices.length > 0) {
        const by = event.key === 'ArrowDown' ? 1 : -1;

        setActiveIndex((current) => (current + by + choices.length) % choices.length);
      }
    }
  };

  const shownIndex = Math.min(activeIndex, Math.max(0, choices.length - 1));

  return (
    <FieldShell label={label} hint={hint}>
      {(ids) => (
        <>
          <div
            ref={root}
            className={cn(
              'min-h-control flex w-full flex-wrap items-center gap-1.5 rounded-field border border-border bg-surface-raised px-2 py-1.5 transition-colors',
              'focus-within:border-primary focus-within:ring-3 focus-within:ring-primary/25',
              disabled && 'cursor-not-allowed opacity-60',
            )}
          >
            {chosen.map((tag) => (
              <TagChip
                key={tag.id}
                color={tag.color}
                icon={icons?.get(tag.icon ?? '')}
                size="small"
                onRemove={
                  disabled
                    ? undefined
                    : () => {
                        take(tag.id);
                      }
                }
              >
                {tag.name}
              </TagChip>
            ))}
            <input
              ref={input}
              id={ids.id}
              type="text"
              role="combobox"
              aria-expanded={isOpen}
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={
                isOpen && choices.length > 0 ? `${listId}-option-${String(shownIndex)}` : undefined
              }
              aria-describedby={ids.describedBy}
              placeholder={chosen.length === 0 ? 'Add a tag…' : undefined}
              disabled={disabled}
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setActiveIndex(0);
                setDraft(null);

                if (!isOpen) {
                  open();
                }
              }}
              onFocus={() => {
                if (!isOpen) {
                  open();
                }
              }}
              onKeyDown={onKeyDown}
              className="min-w-24 flex-1 bg-transparent px-1 text-ui text-foreground outline-none placeholder:text-foreground-disabled"
            />
          </div>

          {placement === null || root.current === null
            ? null
            : createPortal(
                <ul
                  ref={list}
                  id={listId}
                  role="listbox"
                  aria-labelledby={ids.labelId}
                  /* eslint-disable-next-line react/forbid-dom-props -- a position measured from
                     the field at the moment the list opens, and again whenever anything under it
                     scrolls: the RULES.md 15.3 exception, a value no class can carry. */
                  style={{
                    position: 'fixed',
                    left: placement.left,
                    width: placement.width,
                    maxHeight: placement.maxHeight,
                    ...(placement.top === undefined ? {} : { top: placement.top }),
                    ...(placement.bottom === undefined ? {} : { bottom: placement.bottom }),
                  }}
                  className={cn(
                    'z-50 overflow-y-auto rounded-field border border-border-strong',
                    'animate-rise bg-surface p-1 shadow-dialog',
                  )}
                >
                  {draft === null ? (
                    choices.length === 0 ? (
                      <li className="px-2.5 py-2 text-caption text-foreground-subtle">
                        {tags.length === 0 ? 'No tags yet.' : 'Every tag is on it already.'}
                      </li>
                    ) : (
                      choices.map((choice, index) => (
                        /* eslint-disable-next-line jsx-a11y/click-events-have-key-events -- an
                           option in an `aria-activedescendant` listbox is not a focus target;
                           every key is handled on the combobox above. */
                        <li
                          key={'create' in choice ? `create:${choice.create}` : choice.id}
                          id={`${listId}-option-${String(index)}`}
                          role="option"
                          aria-selected={index === shownIndex}
                          onMouseDown={(event) => {
                            // The box must keep focus: losing it would shut the list before the
                            // click ever landed.
                            event.preventDefault();
                          }}
                          onMouseEnter={() => {
                            setActiveIndex(index);
                          }}
                          onClick={() => {
                            choose(index);
                          }}
                          className={cn(
                            'flex h-8 cursor-pointer items-center gap-2 rounded-chip px-2.5 text-ui',
                            index === shownIndex
                              ? 'bg-surface-raised text-foreground'
                              : 'text-foreground-muted',
                          )}
                        >
                          {'create' in choice ? (
                            <span>
                              Create tag <span className="font-medium">“{choice.create}”</span>
                            </span>
                          ) : (
                            <>
                              <span
                                aria-hidden="true"
                                className={cn(
                                  'size-2 shrink-0 rounded-full',
                                  TAG_FILL_CLASSES[choice.color],
                                )}
                              />
                              <span className="truncate">{choice.name}</span>
                            </>
                          )}
                        </li>
                      ))
                    )
                  ) : (
                    <li className="flex flex-col gap-3 p-2">
                      <ColorSwatches
                        label={`Colour for ${draft.name}`}
                        isLabelHidden
                        value={draft.color}
                        disabled={isCreating}
                        onChange={(color) => {
                          setDraft({ ...draft, color });
                        }}
                      />
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          size="compact"
                          variant="ghost"
                          disabled={isCreating}
                          onClick={() => {
                            setDraft(null);
                            input.current?.focus();
                          }}
                        >
                          Cancel
                        </Button>
                        <Button
                          size="compact"
                          isBusy={isCreating}
                          onClick={() => {
                            void create();
                          }}
                        >
                          Create {draft.name}
                        </Button>
                      </div>
                      {problem === null ? null : (
                        <p role="alert" className="text-caption text-danger">
                          {problem}
                        </p>
                      )}
                    </li>
                  )}
                </ul>,
                hostFor(root.current),
              )}
        </>
      )}
    </FieldShell>
  );
}
