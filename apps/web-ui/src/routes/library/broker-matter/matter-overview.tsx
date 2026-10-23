/**
 * The Matter broker's Overview: the health strip, the devices added last, and what the broker is.
 *
 * The strip says how the controller stands and since when, how many devices answer - and which
 * one is silent, and for how long - the fabric and when it was made, and how many of its devices
 * the house also reaches another way. Recently added is the two devices commissioned last, and the
 * way to all of them. About is the broker's facts: what runs it, the port it listens on, how a
 * device comes in, what is asked about a device with a test certificate, where firmware comes
 * from.
 */
import { useTranslation } from 'react-i18next';

import {
  MATTER_TRANSPORT,
  type IntegrationVendorView,
  type MatterStatus,
} from '@nebulahome/contracts';
import { AppIcon, FactGrid, HealthCard, HealthStrip, RowList, Section } from '@nebulahome/ui';

import { dateTimeFormat } from '@/i18n/formatters';
import { relativeTime } from '@/lib/format-time';
import {
  everyRow,
  MatterDeviceRow,
  type MatterRow,
} from '@/routes/library/broker-matter/matter-rows';
import { brokerStateOf } from '@/routes/library/brokers-page';
import type { DeviceIcons } from '@/routes/library/device-icon';

/** How many devices Recently added shows. */
const RECENT = 2;

/** What the tab needs. */
export type MatterOverviewProps = {
  readonly status: MatterStatus;
  readonly rows: readonly MatterRow[];
  readonly icons: DeviceIcons;
  readonly vendors: ReadonlyMap<string, IntegrationVendorView>;

  /** Opens the Devices tab. */
  readonly onSeeDevices: () => void;
};

/**
 * Says how long something has lasted, the way the broker's pages say it: "3 days", "3 h", "12 min".
 *
 * @returns What says it, from when it began until now.
 */
export function useLasted(): (since: Date) => string {
  const { t } = useTranslation();

  return (since) => {
    const minutes = Math.max(1, Math.floor((Date.now() - since.getTime()) / 60_000));
    const hours = Math.floor(minutes / 60);

    return hours >= 24
      ? t('brokers.matter.days', {
          count: Math.floor(hours / 24),
          defaultValue_one: '{{count}} day',
          defaultValue_other: '{{count}} days',
        })
      : hours >= 1
        ? t('brokers.matter.hours', '{{count}} h', { count: hours })
        : t('brokers.matter.minutes', '{{count}} min', { count: minutes });
  };
}

/**
 * Renders the tab.
 *
 * @param props - See {@link MatterOverviewProps}.
 * @returns The tab's content.
 */
export function MatterOverview(props: MatterOverviewProps) {
  const { t } = useTranslation();
  const { status, rows, icons, vendors, onSeeDevices } = props;
  const now = new Date();
  const state = brokerStateOf(status.state);
  const vendorNames = new Map([...vendors].map(([id, vendor]) => [id, vendor.name]));
  const all = everyRow(rows).filter((row) => !row.device.isRemoved);
  const online = all.filter((row) => row.node.isAvailable);
  const silent = all.filter((row) => !row.node.isAvailable);
  const linked = all.filter((row) => row.view?.linked != null);
  const others = [
    ...new Set(
      linked.flatMap((row) =>
        (row.view?.linked?.ways ?? [])
          .filter((way) => way.transport !== MATTER_TRANSPORT)
          .map((way) => vendors.get(way.vendorId)?.name ?? way.vendorId),
      ),
    ),
  ];
  const recent = [...all]
    .filter((row) => !row.device.identity.isBridged)
    .sort(
      (a, b) => (b.node.commissionedAt?.getTime() ?? 0) - (a.node.commissionedAt?.getTime() ?? 0),
    )
    .slice(0, RECENT);

  const lasted = useLasted();
  const [first] = silent;
  const silentLine =
    first === undefined
      ? undefined
      : silent.length > 1
        ? t('brokers.matter.silentMany', '{{name}} and {{count}} more silent', {
            name: first.name,
            count: silent.length - 1,
          })
        : first.node.offlineSince === null
          ? t('brokers.matter.silent', '{{name}} is silent', { name: first.name })
          : t('brokers.matter.silentFor', '{{name}} silent for {{for}}', {
              name: first.name,
              for: lasted(first.node.offlineSince),
            });

  return (
    <div className="flex flex-col gap-8">
      <HealthStrip>
        <HealthCard
          label={t('brokers.matter.controller', 'Controller')}
          tone={
            status.state === 'running'
              ? 'success'
              : status.state === 'failed'
                ? 'danger'
                : 'neutral'
          }
          value={state.label}
          detail={
            status.state === 'running' && status.startedAt !== null
              ? t('brokers.matter.upFor', 'Up {{for}}', { for: lasted(status.startedAt) })
              : undefined
          }
        />
        <HealthCard
          label={t('brokers.matter.devices', 'Devices')}
          tone={all.length === 0 ? 'neutral' : silent.length === 0 ? 'success' : 'warning'}
          value={t('brokers.matter.onlineOfTotal', '{{online}} of {{total}} online', {
            online: online.length,
            total: all.length,
          })}
          detail={silentLine}
          action={
            all.length === 0
              ? undefined
              : {
                  icon: 'arrow-right',
                  verb: t('brokers.matter.seeIt', 'See it'),
                  onSelect: onSeeDevices,
                }
          }
        />
        <HealthCard
          label={t('brokers.matter.fabricLabel', 'Fabric')}
          tone={status.fabricId === null ? 'neutral' : 'success'}
          value={status.fabricId ?? '—'}
          detail={
            status.fabricCreatedAt === null
              ? undefined
              : t('brokers.matter.madeOn', 'Made {{date}}', {
                  date: dateTimeFormat({ day: 'numeric', month: 'long', year: 'numeric' }).format(
                    status.fabricCreatedAt,
                  ),
                })
          }
        />
        <HealthCard
          label={t('brokers.matter.linked', 'Linked')}
          tone={linked.length === 0 ? 'neutral' : 'success'}
          value={t('brokers.matter.linkedCount', {
            count: linked.length,
            defaultValue_one: '{{count}} device',
            defaultValue_other: '{{count}} devices',
          })}
          detail={
            others.length === 0
              ? undefined
              : t('brokers.matter.alsoThrough', 'Also reached through {{names}}', {
                  names: others.join(', '),
                })
          }
        />
      </HealthStrip>

      <Section title={t('brokers.matter.recentlyAdded', 'Recently added')}>
        {recent.length === 0 ? (
          <p className="text-ui text-foreground-subtle">
            {t(
              'brokers.matter.noNodes',
              'No Matter device yet. Add one with the code its app shares.',
            )}
          </p>
        ) : (
          <RowList>
            {recent.map((row) => (
              <MatterDeviceRow
                key={row.key}
                row={row}
                icons={icons}
                vendorNames={vendorNames}
                {...(row.node.commissionedAt === null
                  ? {}
                  : {
                      after: t('brokers.matter.addedWhen', 'added {{when}}', {
                        when: relativeTime(row.node.commissionedAt, now),
                      }),
                    })}
              />
            ))}
            <button
              type="button"
              className="flex items-center gap-1.5 border-t border-border pt-3 pb-3.5 text-ui-sm text-primary transition-colors hover:text-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              onClick={onSeeDevices}
            >
              {t('brokers.matter.allDevices', {
                count: all.length,
                defaultValue_one: 'The {{count}} device',
                defaultValue_other: 'All {{count}} devices',
              })}
              <AppIcon id="chevron-right" size={14} />
            </button>
          </RowList>
        )}
      </Section>

      <Section title={t('brokers.matter.about', 'About')}>
        <FactGrid
          facts={[
            { label: t('brokers.matter.id', 'Id'), value: 'matter', isMono: true },
            {
              label: t('brokers.matter.controller', 'Controller'),
              value:
                status.controllerVersion === null
                  ? 'matter.js'
                  : `matter.js ${status.controllerVersion}`,
              isMono: true,
            },
            {
              label: t('brokers.matter.port', 'Port'),
              value: `UDP ${String(status.port)}`,
              isMono: true,
            },
            {
              label: t('brokers.matter.pairing', 'Pairing'),
              value: t('brokers.matter.pairingValue', 'Over the network, one at a time'),
            },
            {
              label: t('brokers.matter.testDevices', 'Test devices'),
              value: t('brokers.matter.testDevicesValue', 'Asked each time'),
            },
            {
              label: t('brokers.matter.firmwareUpdates', 'Firmware updates'),
              value: t('brokers.matter.firmwareUpdatesValue', 'From the DCL'),
            },
          ]}
        />
      </Section>
    </div>
  );
}
