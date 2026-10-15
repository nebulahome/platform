/**
 * Setting a vendor up: the form its own `setup.json` asks for - an API key, an account - and a
 * Save.
 *
 * What is typed here is shared by every device of the vendor, and the hub puts it under each
 * one when it starts; the device form never asks for it again. The form is drawn two ways from
 * the one state ({@link useVendorSetup}): inline on the vendor page's Configuration tab, and in
 * this dialog, which a vendor that runs a container opens from the container's row.
 *
 * No Test: there is no one device to open a connection to. Whether the key works is found out
 * by the first device added, which is where a wrong key says so.
 */
import { useTranslation } from 'react-i18next';

import type { IntegrationVendorView } from '@nebulahome/contracts';
import { Button, Modal } from '@nebulahome/ui';

import { useVendorSetup, type VendorSetup } from '@/library/use-vendor-setup';
import { SetupForm } from '@/routes/library/setup-form';

/** What the dialog needs. */
export type VendorSetupDialogProps = {
  /** The vendor being set up. Null when the dialog is shut. */
  readonly vendor: IntegrationVendorView | null;

  /** Called to shut it. */
  readonly onClose: () => void;

  /** Called once the settings are written, with the vendor as it now stands. */
  readonly onSaved: (vendor: IntegrationVendorView) => void;
};

/**
 * The fields of both groups, and what is wrong that names no field.
 *
 * @param props - The form's state.
 * @param props.form - See {@link VendorSetup}.
 * @returns The fields.
 */
export function VendorSetupFields(props: { readonly form: VendorSetup }) {
  const { form } = props;

  return (
    <div className="flex flex-col gap-4">
      <SetupForm
        group={form.setup.transport}
        draft={form.drafts.transport}
        errors={form.errors.transport}
        kept={form.kept.transport}
        onChange={form.change('transport')}
      />
      <SetupForm
        group={form.setup.options}
        draft={form.drafts.options}
        errors={form.errors.options}
        kept={form.kept.options}
        onChange={form.change('options')}
      />

      {form.errors.general === undefined ? null : (
        <p role="alert" className="text-ui text-danger">
          {form.errors.general}
        </p>
      )}
    </div>
  );
}

/**
 * Renders the dialog.
 *
 * Mounted fresh each time it opens - the page gives it a key - so the fields start from what
 * the vendor holds and are the person's from then on.
 *
 * @param props - See {@link VendorSetupDialogProps}.
 * @returns The dialog.
 */
export function VendorSetupDialog(props: VendorSetupDialogProps) {
  const { t } = useTranslation();

  const { vendor, onClose, onSaved } = props;
  const form = useVendorSetup(vendor, onSaved);

  return (
    <Modal
      isOpen={vendor !== null}
      onClose={onClose}
      title={t('library.vendorSetupDialog.setUp', 'Set up {{name}}', { name: vendor?.name ?? '' })}
      description={t(
        'library.vendorSetupDialog.whatEveryDeviceOf',
        'What every device of this vendor shares. Each device is asked only for its own address.',
      )}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel', 'Cancel')}
          </Button>
          <Button isBusy={form.isSaving} disabled={form.isSaving} onClick={form.submit}>
            {t('common.save', 'Save')}
          </Button>
        </>
      }
    >
      <VendorSetupFields form={form} />
    </Modal>
  );
}
