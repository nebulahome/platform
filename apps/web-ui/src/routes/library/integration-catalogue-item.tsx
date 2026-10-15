/**
 * An integration's own page in the install dialog: who publishes it, how it reaches its devices,
 * what the Community Hub says of it, the models it works with, and what installing it does -
 * with the owner's word asked first for code nobody reviewed.
 */
import { Trans, useTranslation } from 'react-i18next';

import type { HubDetail, IntegrationListing } from '@nebulahome/contracts';
import { Checkbox } from '@nebulahome/ui';

import { CatalogueChip, CatalogueItem, CatalogueStat } from '@/components/catalogue/catalogue-item';
import { ListingLogo } from '@/components/catalogue/listing-logo';
import { shortCount } from '@/lib/format-count';
import { relativeTime } from '@/lib/format-time';
import { integrationEffects, needsTrust, transportName } from '@/lib/install-effects';

/** What the page needs. */
export type IntegrationCatalogueItemProps = {
  readonly listing: IntegrationListing;

  /** What the Hub says of it; undefined while it is read, or for a local file. */
  readonly detail: HubDetail | undefined;

  /** Whether the owner said they trust who publishes it. */
  readonly isTrusted: boolean;

  /** Called when the owner says so, or takes it back. */
  readonly onTrustChange: (isTrusted: boolean) => void;

  /** What went wrong installing it, in a sentence; null when nothing did. */
  readonly error: string | null;

  /** Whether an install is under way. */
  readonly isInstalling: boolean;
};

/**
 * Renders an integration's page.
 *
 * @param props - See {@link IntegrationCatalogueItemProps}.
 * @returns The page.
 */
export function IntegrationCatalogueItem(props: IntegrationCatalogueItemProps) {
  const { t } = useTranslation();

  const { listing, detail, isTrusted, onTrustChange, error, isInstalling } = props;
  const owner = detail?.owner ?? listing.repository?.split('/')[0] ?? null;
  const internetRequired = listing.internetRequired ?? detail?.internetRequired ?? null;
  const version = listing.latest?.version ?? listing.newestVersion ?? detail?.version ?? null;
  const publishedAt = listing.latest?.publishedAt ?? detail?.publishedAt ?? null;

  return (
    <CatalogueItem
      logo={<ListingLogo listing={listing} size={80} />}
      name={listing.name}
      by={
        listing.origin === 'local'
          ? t(
              'library.integrationCatalogueItem.fromTheIntegrationsFolder',
              'From the integrations folder on this machine',
            )
          : owner === null
            ? null
            : `by ${owner}`
      }
      chips={
        <>
          {listing.isOfficial ? (
            <CatalogueChip tone="accent">
              {t('library.integrationCatalogueItem.official', 'Official')}
            </CatalogueChip>
          ) : null}
          {listing.latest?.source === 'local' ? (
            <CatalogueChip tone="warning" icon="hard-drive">
              {t('library.integrationCatalogueItem.localFile', 'Local file')}
            </CatalogueChip>
          ) : null}
          {internetRequired === null ? null : internetRequired ? (
            <CatalogueChip tone="warning" icon="globe">
              {t('library.integrationCatalogueItem.needsTheInternet', 'Needs the internet')}
            </CatalogueChip>
          ) : (
            <CatalogueChip icon="network">
              {t('library.integrationCatalogueItem.localNetwork', 'Local network')}
            </CatalogueChip>
          )}
          {(detail?.transports ?? []).map((transport) => (
            <CatalogueChip key={transport} icon="cable">
              {transportName(transport)}
            </CatalogueChip>
          ))}
        </>
      }
      stats={
        <>
          {listing.origin === 'hub' ? (
            <>
              <CatalogueStat
                icon="star"
                iconClassName="text-lamp"
                value={shortCount(listing.stars)}
                label={t('library.integrationCatalogueItem.stars', 'stars')}
              />
              <CatalogueStat
                icon="download"
                value={shortCount(listing.downloads)}
                label={t('library.integrationCatalogueItem.installs', 'installs')}
              />
            </>
          ) : null}
          {version === null ? null : <CatalogueStat icon="tag" value={version} />}
          {publishedAt === null ? null : (
            <CatalogueStat
              icon="clock"
              value={relativeTime(publishedAt)}
              label={t(
                'library.integrationCatalogueItem.sinceTheLastRelease',
                'since the last release',
              )}
            />
          )}
        </>
      }
      description={listing.description}
      worksWith={detail?.models}
      effects={listing.latest === null ? [] : integrationEffects(listing, detail)}
    >
      {listing.isBuiltIn ? (
        <p role="status" className="text-ui text-foreground-muted">
          {t(
            'library.integrationCatalogueItem.copyUnderDevelopmentRuns',
            'A copy under development runs from the development folder of the hub. Installing it puts this release in its place.',
          )}
        </p>
      ) : null}

      {listing.installedVersion === null ? null : (
        <p role="status" className="text-ui text-foreground">
          <Trans
            i18nKey="library.integrationCatalogueItem.versionInstalled"
            defaults="Version <0>{{version}}</0> is installed."
            values={{ version: listing.installedVersion }}
            components={[<span key="version" className="font-mono font-medium" />]}
          />{' '}
          {listing.hasUpdate
            ? t('library.integrationCatalogueItem.newerReleaseIsOut', 'A newer release is out.')
            : listing.hasNewBuild
              ? t(
                  'library.integrationCatalogueItem.integrationsFolderHoldsA',
                  'The integrations folder holds a rebuild of it.',
                )
              : t(
                  'library.integrationCatalogueItem.itsPageHasIts',
                  'Its page has its devices and its settings.',
                )}
        </p>
      )}

      {listing.unavailableReason === null ? null : (
        <p role="alert" className="text-ui text-danger">
          {listing.unavailableReason}.
        </p>
      )}

      {needsTrust(listing) && listing.installedVersion === null ? (
        <Checkbox
          label={t(
            'library.integrationCatalogueItem.iTrustWhoPublishes',
            'I trust who publishes it',
          )}
          note={t(
            'library.integrationCatalogueItem.itsCodeRunsInside',
            "Its code runs inside Nebula Home with the same reach as the platform's own.",
          )}
          isChecked={isTrusted}
          disabled={isInstalling}
          onChange={onTrustChange}
        />
      ) : null}

      {error === null ? null : (
        <p role="alert" className="text-ui text-danger">
          {error}
        </p>
      )}

      {isInstalling ? (
        <p role="status" className="text-ui text-foreground-muted">
          {t(
            'library.integrationCatalogueItem.downloadingItAndLoading',
            'Downloading it and loading it into the hub. Nothing restarts.',
          )}
        </p>
      ) : null}
    </CatalogueItem>
  );
}
