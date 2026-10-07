/**
 * The Configuration tab of an integration's page: the settings every device of the vendor shares
 * - an API key, an account - inline, with a Save.
 *
 * The same form, from the same state ({@link useVendorSetup}), as the dialog a vendor that runs a
 * container opens from the container's row. Whether the key works is found out by the first
 * device, which is where a wrong one says so: there is no one device to test it against here.
 */
import type { IntegrationVendorView } from '@nebulahome/contracts';
import { Button, Section } from '@nebulahome/ui';

import { useVendorSetup } from '@/library/use-vendor-setup';
import { VendorSetupFields } from '@/routes/library/vendor-setup-dialog';

/** What the tab needs. */
export type VendorConfigurationProps = {
  readonly vendor: IntegrationVendorView;

  /** Whether the person may change the settings; read-only for anybody else. */
  readonly canConfigure: boolean;

  /** Called once the settings are written, with the vendor as it now stands. */
  readonly onSaved: (vendor: IntegrationVendorView) => void;
};

/**
 * Renders the settings form.
 *
 * @param props - See {@link VendorConfigurationProps}.
 * @returns The tab's content.
 */
export function VendorConfiguration(props: VendorConfigurationProps) {
  const { vendor, canConfigure, onSaved } = props;
  const form = useVendorSetup(vendor, onSaved);

  return (
    <Section
      title="Settings"
      note="What every device of this vendor shares. Each device is asked only for its own address."
    >
      <div className="flex max-w-2xl flex-col gap-5 rounded-card border border-border bg-surface p-5.5">
        <fieldset disabled={!canConfigure} className="contents">
          <VendorSetupFields form={form} />
        </fieldset>

        {canConfigure ? (
          <div className="flex items-center justify-end gap-3">
            {form.isSaved ? (
              <span role="status" className="text-ui-sm text-success">
                Saved
              </span>
            ) : null}
            <Button isBusy={form.isSaving} disabled={form.isSaving} onClick={form.submit}>
              Save
            </Button>
          </div>
        ) : (
          <p className="text-ui-sm text-foreground-subtle">
            Changing these needs the permission to configure integrations.
          </p>
        )}
      </div>
    </Section>
  );
}
