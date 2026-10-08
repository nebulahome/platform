/**
 * The Configuration tab of a package's page: the form its `setup.json` asks for, inline, and a
 * Save that starts it again with what was saved. Nothing else restarts.
 */
import type { ApiPackageDetail, InstalledPackage } from '@nebulahome/contracts';
import { Button, Section } from '@nebulahome/ui';

import { usePackageSetup } from '@/packages/use-package-setup';
import { VendorSetupFields } from '@/routes/library/vendor-setup-dialog';

/** What the tab needs. */
export type PackageConfigurationProps = {
  readonly found: ApiPackageDetail;

  /** Whether the person may change the settings; read-only for anybody else. */
  readonly canConfigure: boolean;

  /** Called once it is saved, with the package as it now stands. */
  readonly onSaved: (saved: InstalledPackage) => void;
};

/**
 * Renders the settings form.
 *
 * @param props - See {@link PackageConfigurationProps}.
 * @returns The tab's content.
 */
export function PackageConfiguration(props: PackageConfigurationProps) {
  const { found, canConfigure, onSaved } = props;
  const form = usePackageSetup(found, onSaved);

  return (
    <Section
      title="Settings"
      note="Saving starts it again with what is saved. Nothing else restarts."
    >
      <div className="flex flex-col gap-5 rounded-card border border-border bg-surface p-5.5">
        <fieldset disabled={!canConfigure} className="contents">
          <VendorSetupFields form={form} />
        </fieldset>

        {canConfigure ? (
          <div className="flex items-center justify-end gap-3">
            {form.isSaved ? (
              <span role="status" className="text-ui-sm text-success">
                Saved, and started again
              </span>
            ) : null}
            <Button isBusy={form.isSaving} disabled={form.isSaving} onClick={form.submit}>
              Save
            </Button>
          </div>
        ) : (
          <p className="text-ui-sm text-foreground-subtle">
            Changing these needs the permission to configure packages.
          </p>
        )}
      </div>
    </Section>
  );
}
