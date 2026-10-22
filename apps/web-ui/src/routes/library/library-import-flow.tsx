/**
 * Importing automations or scenes from a file: choosing it, reading it, picking one when only one
 * is wanted, pointing the entities it names that the house does not have, and handing the result
 * to whoever saves it - the list, which creates them all, or an editor, which fills its draft.
 *
 * A file that is not one, or holds the other kind, is refused by toast; so is one with nothing
 * left to bring in once the port has left out what has no equivalent.
 */
import { useId, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { Modal, toast } from '@nebulahome/ui';

import type { ImportedAutomation, ImportNote } from '@/library/ha-import';
import { readLibraryFile, type LibraryImport } from '@/library/library-file';
import {
  missingOfAutomations,
  missingOfScenes,
  renameAutomations,
  resolveScenes,
  type MissingEntity,
  type ResolvedScene,
} from '@/library/library-import';
import { useEntityDirectory } from '@/routes/library/entity-picker/use-entity-directory';
import { ResolveEntitiesModal } from '@/routes/library/resolve-entities-modal';

/** What an import hands over once the entities are pointed. */
export type ImportResult =
  | { readonly kind: 'automations'; readonly items: readonly ImportedAutomation[] }
  | { readonly kind: 'scenes'; readonly items: readonly ResolvedScene[] };

/** What the flow needs. */
export type LibraryImportFlowProps = {
  /** Which kind it imports; a file of the other kind is refused. */
  readonly kind: 'automations' | 'scenes';

  /** Whether one is wanted - an editor's draft - rather than every one in the file. */
  readonly isSingle?: boolean;

  /** Keys already used, so an imported one that would land on one gets a suffix. */
  readonly takenKeys: readonly string[];

  /** Saves what was imported. A rejection keeps the modal open. */
  readonly onImport: (result: ImportResult) => Promise<void> | void;

  /** The control that starts it, given the function that opens the file chooser. */
  readonly children: (choose: () => void) => ReactNode;
};

/** Where the flow is. */
type Step =
  | { readonly at: 'idle' }
  | { readonly at: 'pick'; readonly file: LibraryImport }
  | {
      readonly at: 'resolve';
      readonly file: LibraryImport;
      readonly missing: readonly MissingEntity[];
    };

/**
 * Renders the file chooser, and the modals the import goes through.
 *
 * @param props - See {@link LibraryImportFlowProps}.
 * @returns The flow.
 */
export function LibraryImportFlow(props: LibraryImportFlowProps) {
  const { t } = useTranslation();

  const { kind, isSingle = false, takenKeys, onImport, children } = props;
  const directory = useEntityDirectory(false);
  const [step, setStep] = useState<Step>({ at: 'idle' });
  const [isBusy, setBusy] = useState(false);
  const inputId = useId();
  /**
   * The house's entity at an address.
   *
   * @param entityId - The address.
   * @returns The entity, or undefined.
   */
  const entityOf = (entityId: string) =>
    directory.entities.find((entity) => entity.entityId === entityId);
  /**
   * Whether the house has an entity at an address.
   *
   * @param entityId - The address.
   * @returns True when it does.
   */
  const has = (entityId: string): boolean => entityOf(entityId) !== undefined;

  /**
   * Goes on to the entities, for the items chosen.
   *
   * @param file - The file, narrowed to what will be imported.
   */
  const resolve = (file: LibraryImport): void => {
    const found =
      file.kind === 'automations'
        ? missingOfAutomations(file.items, has)
        : missingOfScenes(file.items, has);
    const missing = found.map((entry) => {
      const hint = file.hints[entry.entityId];

      return hint === undefined ? entry : { ...entry, hint };
    });

    setStep({ at: 'resolve', file, missing });
  };

  /**
   * Reads the chosen file.
   *
   * @param chosen - The file.
   */
  const read = async (chosen: File): Promise<void> => {
    const reading = readLibraryFile(await chosen.text(), {
      automations: kind === 'automations' ? takenKeys : [],
      scenes: kind === 'scenes' ? takenKeys : [],
    });

    if (!reading.ok) {
      toast.error({
        title: t('library.import.notImported', 'Not imported'),
        message: reading.problem,
      });

      return;
    }

    if (reading.file.kind !== kind) {
      toast.error({
        title: t('library.import.notImported', 'Not imported'),
        message:
          kind === 'automations'
            ? t('library.import.holdsScenes', 'This file holds scenes, not automations.')
            : t('library.import.holdsAutomations', 'This file holds automations, not scenes.'),
      });

      return;
    }

    if (reading.file.items.length === 0) {
      const [first] = reading.file.notes;

      toast.warning({
        title: t('library.import.nothingLeft', 'Nothing to import'),
        ...(first === undefined ? {} : { message: first.message }),
      });

      return;
    }

    if (isSingle && reading.file.items.length > 1) {
      setStep({ at: 'pick', file: reading.file });
    } else {
      resolve(reading.file);
    }
  };

  /**
   * Saves what was imported, with the entities pointed as picked.
   *
   * @param renames - Old address to new.
   */
  const confirm = async (renames: ReadonlyMap<string, string>): Promise<void> => {
    if (step.at !== 'resolve') {
      return;
    }

    setBusy(true);

    try {
      await onImport(
        step.file.kind === 'automations'
          ? { kind: 'automations', items: renameAutomations(step.file.items, renames) }
          : { kind: 'scenes', items: resolveScenes(step.file.items, renames, entityOf) },
      );
      setStep({ at: 'idle' });
    } finally {
      setBusy(false);
    }
  };

  const count = step.at === 'idle' ? 0 : step.file.items.length;
  const notes: readonly ImportNote[] = step.at === 'idle' ? [] : step.file.notes;

  return (
    <>
      {children(() => {
        document.getElementById(inputId)?.click();
      })}
      <input
        id={inputId}
        type="file"
        accept=".json,.yaml,.yml,application/json,application/yaml,text/yaml"
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => {
          const chosen = event.target.files?.[0];

          // Emptied, so the same file chosen again is read again.
          event.target.value = '';

          if (chosen !== undefined) {
            void read(chosen);
          }
        }}
      />

      {step.at === 'pick' ? (
        <Modal
          isOpen
          size="small"
          title={t('library.import.pickTitle', 'Which one?')}
          description={t('library.import.pickDescription', {
            count: step.file.items.length,
            defaultValue_one: 'The file holds {{count}}; pick the one to open here.',
            defaultValue_other: 'The file holds {{count}}; pick the one to open here.',
          })}
          onClose={() => {
            setStep({ at: 'idle' });
          }}
        >
          <ul className="flex max-h-[60vh] flex-col gap-1 overflow-y-auto">
            {step.file.items.map((item, index) => (
              <li key={item.key}>
                <button
                  type="button"
                  className="press flex w-full flex-col items-start rounded-tile border border-transparent px-3 py-2.5 text-left hover:border-border-strong hover:bg-surface-raised focus-visible:ring-3 focus-visible:ring-primary/25 focus-visible:outline-none"
                  onClick={() => {
                    const file = step.file;

                    resolve(
                      file.kind === 'automations'
                        ? {
                            ...file,
                            items: file.items.slice(index, index + 1),
                            notes: file.notes.filter((note) => note.item === item.name),
                          }
                        : {
                            ...file,
                            items: file.items.slice(index, index + 1),
                            notes: file.notes.filter((note) => note.item === item.name),
                          },
                    );
                  }}
                >
                  <span className="text-ui font-medium text-foreground">{item.name}</span>
                  <span className="font-mono text-mono-caption text-foreground-subtle">
                    {item.key}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </Modal>
      ) : null}

      {step.at === 'resolve' ? (
        <ResolveEntitiesModal
          isOpen
          missing={step.missing}
          notes={notes}
          isBusy={isBusy}
          confirmLabel={
            isSingle
              ? t('library.import.useThis', 'Use it')
              : t('library.import.importCount', { count, defaultValue: 'Import {{count}}' })
          }
          onConfirm={(renames) => {
            void confirm(renames);
          }}
          onClose={() => {
            setStep({ at: 'idle' });
          }}
        />
      ) : null}
    </>
  );
}
