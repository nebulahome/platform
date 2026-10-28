/**
 * The Infrared broker's tabs: Overview, Remotes and Blasters.
 *
 * Overview is the health strip - blasters online, remotes, the last code sent, who is listening -
 * then the remotes as rows with View all. Remotes is every remote in a table with a search;
 * Blasters the IR-capable devices integrations provide, each with what it can do. A house with no
 * blaster yet says so, and where to get one, in place of the lists.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import type { InfraredBlaster, InfraredRemote, InfraredStatus } from '@nebulahome/contracts';
import {
  AppIcon,
  HealthCard,
  HealthStrip,
  ListRow,
  RowList,
  Section,
  StatusDot,
} from '@nebulahome/ui';

import { InfraredLogo } from '@/components/brand-logos';
import { relativeTime, shortTime } from '@/lib/format-time';
import { foldForSearch } from '@/lib/search-text';
import {
  BrokerEmpty,
  CountTag,
  DeviceTag,
  HEAD_CELL,
  TABLE_FRAME,
  ViewAll,
} from '@/routes/library/broker-parts';
import { NoMatches } from '@/routes/library/no-matches';
import { SearchField } from '@/routes/library/search-field';

import { BlasterChips, INFRARED_TEXT, KIND_ICONS, KindMark, kindName } from './infrared-parts';

/** Each remote's and blaster's room by its area, and each integration's name. */
type Names = {
  readonly roomOf: (areaId: string | null) => string | null;
};

/**
 * Where a remote goes.
 *
 * @param remote - The remote.
 * @returns Its page.
 */
export function remotePath(remote: Pick<InfraredRemote, 'id'>): string {
  return `/brokers/infrared/remotes/${remote.id}`;
}

/**
 * When a remote was last pressed, or that it was not yet.
 *
 * @param props - The remote.
 * @param props.remote - It.
 * @returns The line.
 */
function LastPressed(props: { readonly remote: InfraredRemote }) {
  const { t } = useTranslation();
  const { lastPressedAt } = props.remote;

  return (
    <span className="text-ui-sm whitespace-nowrap text-foreground-muted">
      {lastPressedAt === null
        ? t('brokers.infrared.neverPressed', 'Not pressed yet')
        : relativeTime(lastPressedAt)}
    </span>
  );
}

/**
 * A remote's blaster as a tag, or the warning that it has none.
 *
 * @param props - The remote.
 * @param props.remote - It.
 * @param props.vendorOf - The integration a blaster comes from.
 * @returns The tag.
 */
function BlasterOf(props: {
  readonly remote: InfraredRemote;
  readonly vendorOf: (blasterId: string) => string | undefined;
}) {
  const { t } = useTranslation();
  const { remote } = props;

  return remote.blasterId === null || remote.blasterName === null ? (
    <span className="inline-flex items-center gap-1.5 text-ui-sm whitespace-nowrap text-warning">
      <AppIcon id="triangle-alert" size={14} />
      {t('brokers.infrared.noBlaster', 'No blaster: pick another one')}
    </span>
  ) : (
    <DeviceTag name={remote.blasterName} vendorName={props.vendorOf(remote.blasterId)} />
  );
}

/**
 * The house with no blaster yet: what a real house sees until a blaster integration is added.
 *
 * @returns The empty state.
 */
export function NoBlaster() {
  const { t } = useTranslation();

  return (
    <BrokerEmpty
      mark={<InfraredLogo width={28} height={28} />}
      title={t('brokers.infrared.noBlasterTitle', 'No IR blaster yet')}
      action={
        <Link
          to="/integrations"
          className="press inline-flex h-control items-center gap-2 rounded-pill border border-border-strong bg-surface-raised px-3.5 text-ui font-medium text-foreground transition-colors hover:bg-surface-high"
        >
          <AppIcon id="external-link" size={15} />
          {t('brokers.infrared.openIntegrations', 'Open Integrations')}
        </Link>
      }
    >
      {t(
        'brokers.infrared.noBlasterLine',
        'Add one from Integrations (Broadlink, Tuya…). A blaster learns the buttons of your remotes, and the house sends them through it.',
      )}
    </BrokerEmpty>
  );
}

/** What Overview needs. */
export type InfraredOverviewProps = Names & {
  readonly status: InfraredStatus;
  readonly remotes: readonly InfraredRemote[];
  readonly blasters: readonly InfraredBlaster[];
  readonly onTab: (tab: 'remotes' | 'blasters') => void;
};

/**
 * Renders Overview.
 *
 * @param props - See {@link InfraredOverviewProps}.
 * @returns The tab's content.
 */
export function InfraredOverview(props: InfraredOverviewProps) {
  const { t } = useTranslation();
  const { status, remotes, blasters, roomOf, onTab } = props;
  const offline = blasters.find((blaster) => !blaster.isOnline);
  const orphan = remotes.find((remote) => remote.blasterId === null);
  const [listening] = status.learning;

  /**
   * The integration a blaster comes from.
   *
   * @param blasterId - The blaster.
   * @returns Its integration's name.
   */
  const vendorOf = (blasterId: string): string | undefined =>
    blasters.find((blaster) => blaster.deviceId === blasterId)?.vendorName;

  return (
    <div className="flex flex-col gap-8">
      <HealthStrip>
        <HealthCard
          label={t('brokers.infrared.blasters', 'Blasters')}
          tone={
            status.blasters.total === 0
              ? 'neutral'
              : status.blasters.online < status.blasters.total
                ? 'warning'
                : 'success'
          }
          value={
            status.blasters.total === 0
              ? t('brokers.infrared.none', 'None yet')
              : t('brokers.infrared.onlineOf', '{{online}} of {{total}} online', {
                  online: status.blasters.online,
                  total: status.blasters.total,
                })
          }
          detail={
            status.blasters.total === 0
              ? t('brokers.infrared.noProvider', 'No integration provides one yet')
              : offline === undefined
                ? undefined
                : offline.lastSentAt === null
                  ? t('brokers.infrared.blasterOffline', '{{name}}: offline', {
                      name: offline.name,
                    })
                  : t('brokers.infrared.blasterOfflineSince', '{{name}}: offline since {{time}}', {
                      name: offline.name,
                      time: shortTime(offline.lastSentAt),
                    })
          }
          action={
            status.blasters.total === 0
              ? undefined
              : {
                  icon: 'chevron-right',
                  verb: t('brokers.infrared.seeBlasters', 'See blasters'),
                  /** Opens Blasters. */
                  onSelect: () => {
                    onTab('blasters');
                  },
                }
          }
        />
        <HealthCard
          label={t('brokers.infrared.remotes', 'Remotes')}
          tone="neutral"
          value={t('brokers.infrared.remoteCount', {
            count: status.remotes,
            defaultValue_one: '{{count}} remote',
            defaultValue_other: '{{count}} remotes',
          })}
          detail={
            status.remotes === 0
              ? t('brokers.infrared.learnedShowHere', 'Learned buttons show here')
              : orphan === undefined
                ? undefined
                : t('brokers.infrared.hasNoBlaster', '{{name}} has no blaster', {
                    name: orphan.name,
                  })
          }
        />
        <HealthCard
          label={t('brokers.infrared.lastSent', 'Last sent')}
          tone="neutral"
          value={
            status.lastSent === null
              ? t('brokers.infrared.nothingSent', 'Nothing yet')
              : `${status.lastSent.remoteName} · ${status.lastSent.buttonName}`
          }
          detail={
            status.lastSent === null
              ? undefined
              : status.lastSent.blasterName === null
                ? relativeTime(status.lastSent.at)
                : t('brokers.infrared.sentThrough', '{{when}} through {{blaster}}', {
                    when: relativeTime(status.lastSent.at),
                    blaster: status.lastSent.blasterName,
                  })
          }
        />
        <HealthCard
          label={t('brokers.infrared.learning', 'Learning')}
          tone={listening === undefined ? 'neutral' : 'info'}
          value={
            listening === undefined
              ? t('brokers.infrared.idle', 'Idle')
              : t('brokers.infrared.listeningOn', 'Listening on {{blaster}}', {
                  blaster: listening.blasterName,
                })
          }
          detail={
            listening === undefined
              ? t('brokers.infrared.noLearnOpen', 'No learn dialog is open')
              : undefined
          }
        />
      </HealthStrip>

      {status.blasters.total === 0 && remotes.length === 0 ? (
        <NoBlaster />
      ) : (
        <Section
          title={t('brokers.infrared.remotesTitle', 'Remotes')}
          note={t(
            'brokers.infrared.remotesNote',
            'A remote opens its keypad, and the blaster it goes through.',
          )}
          actions={
            remotes.length === 0 ? undefined : (
              <ViewAll
                onSelect={() => {
                  onTab('remotes');
                }}
              />
            )
          }
        >
          {remotes.length === 0 ? (
            <p className="text-ui text-foreground-subtle">
              {t('brokers.infrared.noRemotes', 'No remote yet. Add one, then learn its buttons.')}
            </p>
          ) : (
            <RowList>
              {remotes.slice(0, 5).map((remote) => (
                <ListRow
                  key={remote.id}
                  icon={
                    <AppIcon id={KIND_ICONS[remote.kind]} size={16} className={INFRARED_TEXT} />
                  }
                  title={
                    <span className="flex items-center gap-2">
                      {remote.name}
                      <CountTag>
                        {t('brokers.infrared.buttonCount', {
                          count: remote.buttonCount,
                          defaultValue_one: '{{count}} button',
                          defaultValue_other: '{{count}} buttons',
                        })}
                      </CountTag>
                    </span>
                  }
                  subtitle={[kindName(remote.kind), roomOf(remote.areaId)]
                    .filter((part) => part !== null)
                    .join(' · ')}
                  trailing={
                    <>
                      <BlasterOf remote={remote} vendorOf={vendorOf} />
                      <span className="hidden w-28 text-right sm:inline">
                        <LastPressed remote={remote} />
                      </span>
                    </>
                  }
                  hasChevron
                  wrap={(className, parts) => (
                    <Link to={remotePath(remote)} className={className}>
                      {parts}
                    </Link>
                  )}
                />
              ))}
            </RowList>
          )}
        </Section>
      )}
    </div>
  );
}

/** What Remotes needs. */
export type InfraredRemotesProps = Names & {
  readonly remotes: readonly InfraredRemote[];
  readonly blasters: readonly InfraredBlaster[];
};

/**
 * Renders Remotes: every remote, in a table.
 *
 * @param props - See {@link InfraredRemotesProps}.
 * @returns The tab's content.
 */
export function InfraredRemotes(props: InfraredRemotesProps) {
  const { t } = useTranslation();
  const { remotes, blasters, roomOf } = props;
  const [search, setSearch] = useState('');
  const needle = foldForSearch(search.trim());
  const kept = remotes.filter(
    (remote) =>
      needle === '' ||
      foldForSearch(
        [
          remote.name,
          kindName(remote.kind),
          roomOf(remote.areaId) ?? '',
          remote.blasterName ?? '',
        ].join(' '),
      ).includes(needle),
  );
  const headings = [
    t('brokers.infrared.colName', 'Name'),
    t('brokers.infrared.colKind', 'Kind'),
    t('brokers.infrared.colRoom', 'Room'),
    t('brokers.infrared.colBlaster', 'Blaster'),
    t('brokers.infrared.colButtons', 'Buttons'),
    t('brokers.infrared.colLastPressed', 'Last pressed'),
  ];

  return (
    <div className="flex flex-col gap-3.5">
      <SearchField
        className="w-90 lg:w-90"
        placeholder={t('brokers.infrared.searchRemotes', 'Search remotes')}
        value={search}
        onChange={setSearch}
      />
      {remotes.length === 0 ? (
        <p className="text-ui text-foreground-subtle">
          {t('brokers.infrared.noRemotes', 'No remote yet. Add one, then learn its buttons.')}
        </p>
      ) : kept.length === 0 ? (
        <NoMatches
          query={search}
          onClear={() => {
            setSearch('');
          }}
        />
      ) : (
        <div className={TABLE_FRAME}>
          <table className="w-full min-w-200 border-collapse text-left">
            <thead>
              <tr className="border-b border-border">
                {headings.map((heading, index) => (
                  <th
                    key={heading}
                    scope="col"
                    className={index === 0 ? `${HEAD_CELL} pl-5` : HEAD_CELL}
                  >
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {kept.map((remote) => (
                <tr key={remote.id} className="border-t border-border first:border-t-0">
                  <td className="py-3 pr-4 pl-5">
                    <Link
                      to={remotePath(remote)}
                      className="flex items-center gap-3 text-ui font-medium text-foreground hover:text-primary"
                    >
                      <KindMark kind={remote.kind} size="size-8" />
                      {remote.name}
                    </Link>
                  </td>
                  <td className="py-3 pr-4 text-ui text-foreground">{kindName(remote.kind)}</td>
                  <td className="py-3 pr-4 text-ui text-foreground">
                    {roomOf(remote.areaId) ?? t('brokers.infrared.noRoom', 'No room')}
                  </td>
                  <td className="py-3 pr-4">
                    {remote.blasterId === null || remote.blasterName === null ? (
                      <span className="inline-flex items-center gap-1.5 text-ui-sm text-warning">
                        <AppIcon id="triangle-alert" size={14} />
                        {t('brokers.infrared.none', 'None yet')}
                      </span>
                    ) : (
                      <DeviceTag
                        name={remote.blasterName}
                        vendorName={
                          blasters.find((blaster) => blaster.deviceId === remote.blasterId)
                            ?.vendorName
                        }
                      />
                    )}
                  </td>
                  <td className="py-3 pr-4 font-mono text-mono-ui text-foreground">
                    {remote.buttonCount}
                  </td>
                  <td className="py-3 pr-4">
                    <LastPressed remote={remote} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** What Blasters needs. */
export type InfraredBlastersProps = Names & {
  readonly blasters: readonly InfraredBlaster[];
};

/**
 * Renders Blasters: the IR-capable devices integrations provide.
 *
 * @param props - See {@link InfraredBlastersProps}.
 * @returns The tab's content.
 */
export function InfraredBlasters(props: InfraredBlastersProps) {
  const { t } = useTranslation();
  const { blasters, roomOf } = props;

  if (blasters.length === 0) {
    return <NoBlaster />;
  }

  return (
    <Section
      title={t('brokers.infrared.blastersTitle', 'Blasters')}
      note={t(
        'brokers.infrared.blastersNote',
        'IR-capable devices that integrations provide. A remote can move from one to another without learning again.',
      )}
      actions={
        <Link
          to="/integrations"
          className="inline-flex items-center gap-1.5 text-ui-sm font-medium text-foreground hover:text-primary"
        >
          {t('brokers.infrared.findMore', 'Find more in Integrations')}
          <AppIcon id="external-link" size={14} />
        </Link>
      }
    >
      <RowList>
        {blasters.map((blaster) => (
          <ListRow
            key={blaster.deviceId}
            icon={
              <span className="font-mono text-mono-ui text-primary">
                {blaster.vendorName.slice(0, 1).toUpperCase()}
              </span>
            }
            title={
              <span className="flex items-center gap-2">
                {blaster.name}
                <DeviceTag name={blaster.vendorName} />
              </span>
            }
            subtitle={roomOf(blaster.areaId) ?? t('brokers.infrared.noRoom', 'No room')}
            trailing={
              <>
                <BlasterChips blaster={blaster} />
                <span className="hidden w-40 text-right text-ui-sm text-foreground-muted md:inline">
                  {blaster.lastSentAt === null
                    ? t('brokers.infrared.neverSent', 'Nothing sent yet')
                    : t('brokers.infrared.lastSentAt', 'Last sent {{when}}', {
                        when: relativeTime(blaster.lastSentAt),
                      })}
                </span>
                <span className="flex w-20 items-center gap-1.5 text-ui-sm">
                  <StatusDot
                    isBare
                    tone={blaster.isOnline ? 'success' : 'warning'}
                    title={
                      blaster.isOnline
                        ? t('brokers.infrared.online', 'Online')
                        : t('brokers.infrared.offline', 'Offline')
                    }
                  />
                  <span className={blaster.isOnline ? 'text-success' : 'text-warning'}>
                    {blaster.isOnline
                      ? t('brokers.infrared.online', 'Online')
                      : t('brokers.infrared.offline', 'Offline')}
                  </span>
                </span>
              </>
            }
            hasChevron
            wrap={(className, parts) => (
              <Link to={`/devices/${blaster.deviceId}`} className={className}>
                {parts}
              </Link>
            )}
          />
        ))}
      </RowList>
    </Section>
  );
}
