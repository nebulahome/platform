/**
 * Choosing which kind of block to insert.
 *
 * A searchable, grouped list rather than a SelectField: Then alone has more than a dozen kinds,
 * and a dropdown that long is a scroll trap. Picking one inserts above the dashed placeholder
 * that opened this dialog and closes it.
 */
import { useMemo, useState, type KeyboardEvent } from 'react';

import { Button, Modal, TextField, cn } from '@nebulahome/ui';

import type { EditorChoiceGroup } from '@/routes/library/editor-choices';

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
 * Renders the block picker.
 *
 * @param props - See {@link BlockPickerModalProps}.
 * @returns The dialog.
 */
export function BlockPickerModal(props: BlockPickerModalProps) {
  const { isOpen, onClose, title, description, groups, onPick } = props;
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();

    if (needle === '') {
      return groups;
    }

    return groups
      .map((group) => ({
        ...group,
        choices: group.choices.filter(
          (choice) =>
            choice.label.toLowerCase().includes(needle) ||
            choice.value.toLowerCase().includes(needle) ||
            (choice.description?.toLowerCase().includes(needle) ?? false),
        ),
      }))
      .filter((group) => group.choices.length > 0);
  }, [groups, search]);

  /**
   * Keeps Escape on this dialog when nested over another.
   *
   * @param event - The key press.
   */
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onClose();
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={() => {
        setSearch('');
        onClose();
      }}
      title={title}
      description={description}
      size="large"
      footer={
        <Button
          variant="ghost"
          onClick={() => {
            setSearch('');
            onClose();
          }}
        >
          Cancel
        </Button>
      }
    >
      {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions */}
      <div className="flex flex-col gap-4" onKeyDown={onKeyDown}>
        <TextField
          label="Search blocks"
          isLabelHidden
          size="compact"
          type="search"
          placeholder="Search blocks…"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
          }}
        />

        {filtered.length === 0 ? (
          <p className="text-ui text-foreground-muted">Nothing matches.</p>
        ) : (
          <div className="flex max-h-96 flex-col gap-4 overflow-y-auto pr-1">
            {filtered.map((group) => (
              <section key={group.title} className="flex flex-col gap-2">
                <h3 className="text-caption font-medium text-foreground-subtle">{group.title}</h3>
                <ul className="flex flex-col gap-1" aria-label={group.title}>
                  {group.choices.map((choice) => (
                    <li key={choice.value}>
                      <button
                        type="button"
                        className={cn(
                          'flex w-full flex-col items-start gap-0.5 rounded-field border border-transparent px-3 py-2.5 text-left',
                          'text-foreground transition-colors hover:border-border hover:bg-surface-raised',
                          'focus-visible:ring-3 focus-visible:ring-primary/25 focus-visible:outline-none',
                        )}
                        onClick={() => {
                          setSearch('');
                          onPick(choice.value);
                        }}
                      >
                        <span className="text-ui font-medium">{choice.label}</span>
                        {choice.description === undefined ? null : (
                          <span className="text-caption text-foreground-subtle">
                            {choice.description}
                          </span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}
