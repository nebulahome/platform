/**
 * A package's own page (PACKAGES_DOCS.md 6.5): what the package draws to be managed, with paths of
 * its own under `/packages/<id>/app/`.
 *
 * The interface draws the header - `Packages / Recorder`, and the way to the package's details -
 * and the package draws everything under it: its sub-pages are its paths, read with
 * `usePackageRoute` and reached with `PackageLink`, so the browser's address, history and back
 * button work inside it as they do everywhere else. The page is drawn while the package runs;
 * otherwise the header stays and says why there is nothing under it.
 */
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router';

import { Button, Panel, PanelNote } from '@nebulahome/ui';

import { translate } from '@/i18n/messages';
import { PackageSlot } from '@/packages/package-slot';
import { useInstalledPackages } from '@/packages/use-packages';
import { LibraryPage } from '@/routes/library/library-page';

/**
 * Renders a package's own page.
 *
 * @returns The page.
 */
export function PackageAppPage() {
  const { t } = useTranslation();

  const { packageId = '' } = useParams();
  const navigate = useNavigate();
  const { packages, isPending, error } = useInstalledPackages();
  const found = packages.find((each) => each.id === packageId);
  const title = found?.ui?.sidebar?.label ?? found?.name ?? packageId;

  let body: ReactNode;

  if (found === undefined) {
    body = (
      <Panel title={packageId} elevation="flat">
        <PanelNote>
          {t(
            'packages.packageApp.packageidPackageIsNot',
            'The {{packageId}} package is not installed.',
            { packageId },
          )}
        </PanelNote>
      </Panel>
    );
  } else if (found.ui?.page !== true) {
    body = (
      <Panel title={found.name} elevation="flat">
        <PanelNote>
          {t('packages.packageApp.nameHasNoPage', '{{name}} has no page of its own.', {
            name: found.name,
          })}
        </PanelNote>
      </Panel>
    );
  } else if (found.state === 'running') {
    body = (
      <PackageSlot
        found={found}
        target={{ kind: 'page', props: { packageId: found.id } }}
        loading={
          <p role="status" className="text-ui text-foreground-subtle">
            {t('packages.packageApp.loadingName', 'Loading {{name}}…', { name: found.name })}
          </p>
        }
        renderProblem={(message) => (
          <Panel title={found.name} elevation="flat">
            <PanelNote>
              {t(
                'packages.packageApp.nameCouldNotDraw',
                '{{name}} could not draw its page: {{message}}',
                { name: found.name, message },
              )}
            </PanelNote>
          </Panel>
        )}
      />
    );
  } else {
    body = (
      <Panel title={found.name} elevation="flat">
        <PanelNote>
          {t('packages.packageApp.itsPageIsDrawn', 'Its page is drawn while it runs.')}
        </PanelNote>
      </Panel>
    );
  }

  return (
    <LibraryPage
      title={title}
      parent={{ to: '/packages', label: t('packages.packageApp.packages', 'Packages') }}
      counted={(count) =>
        translate('packages.pageCount', {
          count,
          defaultValue_one: '{{count}} page',
          defaultValue_other: '{{count}} pages',
        })
      }
      action={
        <Button
          variant="ghost"
          onClick={() => {
            void navigate(`/packages/${encodeURIComponent(packageId)}`);
          }}
        >
          {t('packages.packageApp.details', 'Details')}
        </Button>
      }
      isPending={isPending}
      error={error}
      isEmpty={false}
    >
      {body}
    </LibraryPage>
  );
}
