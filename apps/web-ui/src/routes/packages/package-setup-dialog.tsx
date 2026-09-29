/**
 * Configuring a package: the form its `setup.json` asks for, and a Save that starts it again with
 * what was saved.
 *
 * The same grammar, the same helpers and the same checks as a vendor's setup: two groups, the
 * secrets kept unless something is typed over them, the server's word on what is wrong shown
 * under the field it names.
 */
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';

import type { ApiPackageDetail, InstalledPackage, JsonObject } from '@nebula-home/contracts';
import { Button, Modal } from '@nebula-home/ui';

import { toMessage } from '@/lib/error-message';
import {
  errorsByField,
  initialDraft,
  keptSecrets,
  serverIssuesOf,
  toValues,
  type DraftValue,
  type SetupDraft,
} from '@/library/setup-values';
import { configurePackage } from '@/packages/api';
import { SetupForm } from '@/routes/library/setup-form';

/** What the dialog needs. */
export type PackageSetupDialogProps = {
  /** The package; null while the dialog is shut. */
  readonly found: ApiPackageDetail | null;

  readonly onClose: () => void;

  /** Called once it is saved, with the package as it now stands. */
  readonly onSaved: (saved: InstalledPackage) => void;
};

/** What the form holds, for both groups. */
type Drafts = { readonly transport: SetupDraft; readonly options: SetupDraft };

/** What is wrong, per group and field, plus anything that names no field. */
type Errors = {
  readonly transport: Readonly<Record<string, string>>;
  readonly options: Readonly<Record<string, string>>;
  readonly general: string | undefined;
};

/** Nothing wrong. */
const NO_ERRORS: Errors = { transport: {}, options: {}, general: undefined };

/** A setup that asks nothing, for while the dialog is shut. */
const EMPTY_SETUP = {
  transport: { constants: {}, fields: [] },
  options: { constants: {}, fields: [] },
};

/**
 * Renders the dialog. Mounted afresh each time it opens, so the fields start from what is saved.
 *
 * @param props - See {@link PackageSetupDialogProps}.
 * @returns The dialog.
 */
export function PackageSetupDialog(props: PackageSetupDialogProps) {
  const { found, onClose, onSaved } = props;
  const setup = found?.setup ?? EMPTY_SETUP;
  const saved: JsonObject = found?.config ?? {};
  const mode = Object.keys(saved).length === 0 ? 'complete' : 'partial';
  const kept = {
    transport: keptSecrets(setup.transport, saved),
    options: keptSecrets(setup.options, saved),
  };
  const [drafts, setDrafts] = useState<Drafts>(() => ({
    transport: initialDraft(setup.transport, saved),
    options: initialDraft(setup.options, saved),
  }));
  const [errors, setErrors] = useState<Errors>(NO_ERRORS);

  const save = useMutation({
    /**
     * Writes the settings.
     *
     * @param body - The two groups, as read.
     * @param body.transportConfig - The first group.
     * @param body.options - The second.
     * @returns The package as it now stands.
     */
    mutationFn: async (body: { transportConfig: JsonObject; options: JsonObject }) =>
      configurePackage(found?.id ?? '', body),

    onSuccess: onSaved,

    /**
     * Keeps the server's word on what is wrong, field by field where it named one.
     *
     * @param error - What the request threw.
     */
    onError: (error: unknown): void => {
      const issues = serverIssuesOf(error);

      setErrors({
        transport: errorsByField(issues, 'transportConfig'),
        options: errorsByField(issues, 'options'),
        general:
          issues.length > 0 && issues.every((issue) => issue.path.includes('.'))
            ? undefined
            : toMessage(error),
      });
    },
  });

  /**
   * Changes one field of one group.
   *
   * @param group - Which group.
   * @returns The change handler the form calls.
   */
  const change =
    (group: 'transport' | 'options') =>
    (key: string, value: DraftValue): void => {
      setDrafts((current) => ({ ...current, [group]: { ...current[group], [key]: value } }));
    };

  /** Reads both drafts and saves them when nothing is wrong. */
  const submit = (): void => {
    const transport = toValues(setup.transport, drafts.transport, mode);
    const options = toValues(setup.options, drafts.options, mode);

    setErrors({ transport: transport.errors, options: options.errors, general: undefined });

    if (Object.keys(transport.errors).length === 0 && Object.keys(options.errors).length === 0) {
      save.mutate({ transportConfig: transport.values, options: options.values });
    }
  };

  return (
    <Modal
      isOpen={found !== null}
      onClose={onClose}
      title={`Configure ${found?.name ?? ''}`}
      description="Saving starts it again with what is saved. Nothing else restarts."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button isBusy={save.isPending} disabled={save.isPending} onClick={submit}>
            Save
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <SetupForm
          group={setup.transport}
          draft={drafts.transport}
          errors={errors.transport}
          kept={kept.transport}
          onChange={change('transport')}
        />
        <SetupForm
          group={setup.options}
          draft={drafts.options}
          errors={errors.options}
          kept={kept.options}
          onChange={change('options')}
        />

        {errors.general === undefined ? null : (
          <p role="alert" className="text-ui text-danger">
            {errors.general}
          </p>
        )}
      </div>
    </Modal>
  );
}
