/**
 * The entities an import names that this house does not have, for the person to point at their
 * own (board-less: built from the Modal, Panel and EntityField the editors use).
 *
 * One row per address, with how often it is used and what it has to be able to do, and a field
 * that picks from the entities that can. Nothing has to be picked: what is left goes in as it is,
 * and the automation or scene it is in is marked in error and does not run until it is pointed at
 * something. Below, what the port left out, when it left anything.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { AppIcon, Button, Modal, Note } from '@nebulahome/ui';

import { hasCapability } from '@/library/entity-control';
import type { ImportNote } from '@/library/ha-import';
import type { MissingEntity } from '@/library/library-import';
import { EntityField } from '@/routes/library/entity-field';

/** What the modal needs. */
export type ResolveEntitiesModalProps = {
  readonly isOpen: boolean;

  /** The addresses the house does not have. */
  readonly missing: readonly MissingEntity[];

  /** What the port left out, item by item. */
  readonly notes?: readonly ImportNote[];

  /** What the main button says: "Import 12", "Use these". */
  readonly confirmLabel: string;

  /** Whether the import is under way. */
  readonly isBusy?: boolean;

  /** Called with what was picked: old address to new; the rest left as they are. */
  readonly onConfirm: (renames: ReadonlyMap<string, string>) => void;

  readonly onClose: () => void;
};

/**
 * Renders the modal.
 *
 * @param props - See {@link ResolveEntitiesModalProps}.
 * @returns The modal.
 */
export function ResolveEntitiesModal(props: ResolveEntitiesModalProps) {
  const { t } = useTranslation();

  const { isOpen, missing, notes = [], confirmLabel, isBusy = false, onConfirm, onClose } = props;
  const [picked, setPicked] = useState<ReadonlyMap<string, string>>(new Map());
  const left = missing.filter((entry) => !picked.has(entry.entityId)).length;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      size="medium"
      title={
        missing.length === 0
          ? t('library.resolveEntities.readyTitle', 'Ready to import')
          : t('library.resolveEntities.title', 'Entities not found')
      }
      description={
        missing.length === 0
          ? t('library.resolveEntities.allFound', 'Every entity the file names is in this house.')
          : t(
              'library.resolveEntities.description',
              'The file names entities this house calls something else, or does not have. Point each at one of yours, or leave it: what is left is marked in error and does not run until you pick one.',
            )
      }
      footer={
        <>
          <Button variant="ghost" disabled={isBusy} onClick={onClose}>
            {t('common.cancel', 'Cancel')}
          </Button>
          <Button
            isBusy={isBusy}
            onClick={() => {
              onConfirm(picked);
            }}
          >
            <AppIcon id="check" size={15} />
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {missing.length === 0 ? null : (
          <ul className="flex flex-col gap-3">
            {missing.map((entry) => (
              <li
                key={entry.entityId}
                className="grid gap-3 rounded-inner border border-border bg-surface px-3.5 py-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] sm:items-center"
              >
                <div className="min-w-0">
                  <p className="flex items-center gap-1.5 font-mono text-ui break-all text-foreground">
                    <AppIcon
                      id={picked.has(entry.entityId) ? 'check' : 'triangle-alert'}
                      size={14}
                      className={
                        picked.has(entry.entityId)
                          ? 'shrink-0 text-success'
                          : 'shrink-0 text-warning'
                      }
                    />
                    {entry.entityId}
                  </p>
                  {entry.hint === undefined ? null : (
                    <p className="text-caption text-foreground-muted">{entry.hint}</p>
                  )}
                  <p className="text-caption text-foreground-subtle">
                    {t('library.resolveEntities.uses', {
                      count: entry.uses,
                      defaultValue_one: 'Used once',
                      defaultValue_other: 'Used {{count}} times',
                    })}
                    {entry.capabilities.length === 0 ? '' : ` · ${entry.capabilities.join(', ')}`}
                  </p>
                </div>
                <EntityField
                  label={t('library.resolveEntities.standsFor', 'Use instead')}
                  isLabelHidden
                  isOptional
                  value={picked.get(entry.entityId) ?? ''}
                  accept={(entity) =>
                    entry.capabilities.every((capability) => hasCapability(entity, capability))
                  }
                  onChange={(entityId) => {
                    const next = new Map(picked);

                    if (entityId === '') {
                      next.delete(entry.entityId);
                    } else {
                      next.set(entry.entityId, entityId);
                    }

                    setPicked(next);
                  }}
                />
              </li>
            ))}
          </ul>
        )}

        {left > 0 ? (
          <Note tone="warning">
            {t('library.resolveEntities.left', {
              count: left,
              defaultValue_one: '1 entity is left as it is: what names it will be marked in error.',
              defaultValue_other:
                '{{count}} entities are left as they are: what names them will be marked in error.',
            })}
          </Note>
        ) : null}

        {notes.length === 0 ? null : (
          <details className="rounded-inner border border-border bg-surface px-3.5 py-3">
            <summary className="cursor-pointer text-ui font-medium text-foreground">
              {t('library.resolveEntities.notes', {
                count: notes.length,
                defaultValue_one: '1 thing was left out or changed',
                defaultValue_other: '{{count}} things were left out or changed',
              })}
            </summary>
            <ul className="mt-2.5 flex flex-col gap-1.5">
              {notes.map((note, index) => (
                // Notes repeat word for word across items; their place is what tells them apart.
                // eslint-disable-next-line react/no-array-index-key
                <li key={index} className="text-caption text-foreground-muted">
                  <span className="font-medium text-foreground">{note.item}</span> · {note.message}
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </Modal>
  );
}
