/**
 * One entity's own page: what it is doing now, what it has done, and the facts about it.
 *
 * As the board draws it, one column: the way back to its device, the entity's tile, name and what
 * it is, its state as a Pill with its area and its id, Settings - then the health strip
 * (Availability, Last change with what caused it, Device, Integration), its Control, its History
 * with the recent changes, what else in the house names it, and the facts about it.
 *
 * What it is called, drawn as and tagged with is a dialog behind Settings - the way a device's is
 * on its page - and `?settings` in the address opens the page with it open, which is where the
 * spanner on an entity's row leads.
 *
 * A reading linked across two ways says so: the linked tag in the hero and "Unlink…" in its ⋮
 * menu, the way it comes through in the strip, a Transport section with both sources, the way
 * each change came in through in its History, and the order of the two in Details.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams, useSearchParams } from 'react-router';

import { pollIntervalMsOf } from '@nebulahome/contracts';
import {
  AppIcon,
  Button,
  DetailHero,
  HealthCard,
  HealthStrip,
  HeroFact,
  OverflowMenu,
  Pill,
} from '@nebulahome/ui';

import { useSession } from '@/auth/session-store';
import { relativeTime } from '@/lib/format-time';
import { fetchStateHistory, LIBRARY_QUERY_KEYS } from '@/library/api';
import { hasCapability } from '@/library/entity-control';
import { entityKindOf } from '@/library/entity-kind';
import { isActiveState, windowOfChoice } from '@/library/history-series';
import { useCauseNames } from '@/library/use-cause-names';
import { BackLink, DetailFrame } from '@/routes/library/detail-page';
import { devicePath } from '@/routes/library/device/device-path';
import { LinkDialog, type LinkRequest } from '@/routes/library/device/link-dialog';
import { ControlPanel } from '@/routes/library/entity/controls/control-panel';
import { CorrelationsPanel } from '@/routes/library/entity/correlations-panel';
import { DetailsPanel } from '@/routes/library/entity/details-panel';
import { ENTITY_SETTINGS_PARAM } from '@/routes/library/entity/entity-path';
import { EntitySettingsDialog } from '@/routes/library/entity/entity-settings-dialog';
import { HistoryPanel } from '@/routes/library/entity/history-panel';
import {
  choiceWords,
  TransportPanel,
  useEntityWays,
  type EntityWays,
} from '@/routes/library/entity/transport-panel';
import { useEntityPage, type EntityPageView } from '@/routes/library/entity/use-entity-page';
import { EntityTile } from '@/routes/library/entity-tile';
import { waysOfEntity, WaysTag } from '@/routes/library/transport-marks';

/**
 * A polling interval in short words: "Every 5 s", "Every 2 min".
 *
 * @param ms - The interval.
 * @returns The words.
 */
function everyText(ms: number): string {
  return ms < 60_000
    ? `Every ${String(Math.round(ms / 1000))} s`
    : `Every ${String(Math.round(ms / 60_000))} min`;
}

/**
 * The health strip of an entity: whether it reports, its last change and what made it, the
 * device it belongs to, and the integration that brings it.
 *
 * For one read two ways, the way it comes through, and how the two are ordered in place of the
 * integration.
 *
 * @param props - The page's view.
 * @param props.view - See {@link EntityPageView}.
 * @param props.ways - How it is read, for one read two ways.
 * @returns The strip.
 */
function EntityHealth(props: { readonly view: EntityPageView; readonly ways: EntityWays | null }) {
  const { t } = useTranslation();

  const { view, ways } = props;
  const { entity, reading, device, vendorName } = view;
  const nameOf = useCauseNames();
  const isReading = hasCapability(entity, 'sensor_numeric');

  // The same window, under the same key, as the History opens on: one read for both.
  const changes = useQuery({
    queryKey: [...LIBRARY_QUERY_KEYS.history, entity.entityId, 'state', '24h'],
    enabled: !isReading,

    /**
     * Reads the last day's changes, for the newest and what caused it.
     *
     * @param context - The abort signal.
     * @param context.signal - Cancels the read.
     * @returns The window and its changes.
     */
    queryFn: async ({ signal }: { signal: AbortSignal }) => {
      const window = windowOfChoice({ kind: 'preset', range: '24h' }, Date.now());
      const points = await fetchStateHistory(
        { entityId: entity.entityId, from: new Date(window.from), to: new Date(window.to) },
        signal,
      );

      return { window, points };
    },
  });
  const latest = changes.data?.points.at(-1);
  const every = device === undefined ? undefined : pollIntervalMsOf(device.options);
  const seen = reading.at === null ? 'never' : relativeTime(reading.at);

  return (
    <HealthStrip>
      <HealthCard
        label={t('entity.entity.availability', 'Availability')}
        tone={reading.isAvailable ? 'success' : 'warning'}
        value={reading.isAvailable ? 'Reporting' : 'Unreachable'}
        detail={
          reading.isAvailable
            ? ways?.active == null
              ? `${every === undefined ? t('entity.entity.onEveryChange', 'On every change') : everyText(every)} · ${seen}`
              : t('entity.entity.throughSeen', 'Through {{way}} · {{seen}}', {
                  way: ways.active.name,
                  seen,
                })
            : t('entity.entity.lastValue', 'Last value {{seen}}', { seen })
        }
      />
      <HealthCard
        label={t('entity.entity.lastChange', 'Last change')}
        tone="success"
        value={
          entity.lastChanged === null
            ? t('entity.entity.noneYet', 'None yet')
            : relativeTime(entity.lastChanged)
        }
        detail={
          isReading
            ? reading.text
            : latest === undefined
              ? t('entity.entity.nothingChangedToday', 'Nothing changed today')
              : `${latest.isAvailable ? t('entity.entity.changed', 'Changed') : t('entity.entity.wentAway', 'Went away')} · ${nameOf(latest.context).label}`
        }
      />
      <HealthCard
        label={t('entity.entity.device', 'Device')}
        tone={device === undefined ? 'neutral' : device.state === 'failed' ? 'warning' : 'success'}
        value={device?.name ?? 'None'}
        detail={
          device === undefined
            ? t('entity.entity.itIsWorkedOut', 'It is worked out, not a device')
            : [
                device.model ?? device.driverName,
                ways === null
                  ? device.state === 'running'
                    ? 'reporting'
                    : device.state
                  : t('entity.entity.linked', 'linked'),
              ]
                .filter(Boolean)
                .join(' · ')
        }
      />
      {ways === null ? (
        <HealthCard
          label={t('entity.entity.integration', 'Integration')}
          tone={device?.state === 'failed' ? 'warning' : 'success'}
          value={vendorName ?? 'Nebula Home'}
          detail={device?.state === 'failed' ? (device.lastError ?? 'Failing') : 'Running'}
        />
      ) : (
        <HealthCard
          label={t('entity.entity.transport', 'Transport')}
          tone={ways.active === null ? 'warning' : 'success'}
          value={ways.active?.name ?? t('entity.entity.neither', 'Neither')}
          detail={choiceWords(ways, t)}
        />
      )}
    </HealthStrip>
  );
}

/**
 * Renders an entity's page.
 *
 * @returns The page.
 */
export function EntityPage() {
  const { t } = useTranslation();

  const { entityId = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const isSettingsOpen = params.has(ENTITY_SETTINGS_PARAM);
  const { view, isPending, error } = useEntityPage(entityId);
  const queryClient = useQueryClient();
  const [unlinking, setUnlinking] = useState<LinkRequest | null>(null);
  // Linking and unlinking change the device, and are the device's to allow.
  const canLink = useSession((state) => state.can('device:write'));
  const ways = useEntityWays(view?.entity);

  /**
   * Opens the settings dialog, or shuts it, in the address so the back button agrees.
   *
   * @param isOpen - Whether it should be open.
   */
  const showSettings = (isOpen: boolean): void => {
    setParams(
      (current) => {
        const next = new URLSearchParams(current);

        if (isOpen) {
          next.set(ENTITY_SETTINGS_PARAM, '1');
        } else {
          next.delete(ENTITY_SETTINGS_PARAM);
        }

        return next;
      },
      { replace: true },
    );
  };

  const kind = view === undefined ? null : entityKindOf(view.entity);
  const place =
    view === undefined
      ? ''
      : [view.floor?.name, view.room?.name ?? view.entity.areaName].filter(Boolean).join(' › ');
  const isActive = view === undefined ? null : isActiveState(view.state);

  return (
    <>
      <DetailFrame
        isPending={isPending}
        error={view === undefined ? error : undefined}
        hero={
          <DetailHero
            back={
              view?.device === undefined ? (
                <BackLink to="/devices">{t('entity.entity.devices', 'Devices')}</BackLink>
              ) : (
                <BackLink to={devicePath(view.device.id)}>{view.device.name}</BackLink>
              )
            }
            mark={
              view === undefined || kind === null ? undefined : (
                <EntityTile
                  size="large"
                  icon={view.entity.icon === null ? undefined : view.icons.get(view.entity.icon)}
                  kind={kind}
                  isActive={isActive}
                  isAvailable={view.reading.isAvailable}
                />
              )
            }
            title={view?.entity.name ?? entityId}
            description={
              kind === null
                ? undefined
                : [kind.label, place].filter((part) => part !== '').join(' · ')
            }
            facts={
              view === undefined ? undefined : (
                <>
                  <Pill
                    tone={
                      !view.reading.isAvailable
                        ? 'warning'
                        : isActive === true
                          ? 'success'
                          : 'neutral'
                    }
                  >
                    {view.reading.isAvailable
                      ? view.reading.text
                      : t('entity.entity.unreachable', 'Unreachable')}
                  </Pill>
                  {place === '' ? null : <HeroFact icon="house">{place}</HeroFact>}
                  {ways === null ? (
                    <HeroFact className="font-mono">{view.entity.entityId}</HeroFact>
                  ) : (
                    <WaysTag ways={waysOfEntity(view.entity)} isLabelled />
                  )}
                </>
              )
            }
            actions={
              view === undefined ? undefined : (
                <>
                  <Button
                    variant="ghost"
                    aria-label={t('entity.entity.configureName', 'Configure {{name}}', {
                      name: view.entity.name,
                    })}
                    onClick={() => {
                      showSettings(true);
                    }}
                  >
                    <AppIcon id="settings" size={15} />
                    {t('entity.entity.settings', 'Settings')}
                  </Button>
                  {ways === null || !canLink ? null : (
                    <OverflowMenu
                      label={t('entity.entity.moreFor', 'More for {{name}}', {
                        name: view.entity.name,
                      })}
                      items={[
                        {
                          label: t('entity.entity.unlink', 'Unlink…'),
                          icon: 'unlink-2',
                          tone: 'danger',
                          /** Asks to unlink the reading. */
                          onSelect: () => {
                            setUnlinking({
                              action: 'unlink',
                              target: { scope: 'entity', id: view.entity.entityId },
                            });
                          },
                        },
                      ]}
                    />
                  )}
                </>
              )
            }
          />
        }
      >
        {view === undefined ? null : (
          <div className="flex flex-col gap-8">
            <EntityHealth view={view} ways={ways} />
            <ControlPanel
              entity={view.entity}
              state={view.state}
              reportedAt={view.reportedAt}
              reading={view.reading}
              canControl={view.canControl}
            />
            {ways === null ? null : (
              <TransportPanel entity={view.entity} ways={ways} device={view.device} />
            )}
            <HistoryPanel
              entity={view.entity}
              reading={view.reading}
              current={view.live?.state ?? view.entity.state}
              ways={ways}
            />
            <CorrelationsPanel entityId={view.entity.entityId} />
            <DetailsPanel view={view} ways={ways} />
          </div>
        )}
      </DetailFrame>

      <LinkDialog
        request={unlinking}
        lines={[]}
        onClose={() => {
          setUnlinking(null);
        }}
        onDone={() => {
          setUnlinking(null);
          void queryClient.invalidateQueries({ queryKey: LIBRARY_QUERY_KEYS.entities });
          void queryClient.invalidateQueries({ queryKey: LIBRARY_QUERY_KEYS.devices });
        }}
      />

      {view === undefined ? null : (
        <EntitySettingsDialog
          // Keyed on whether it is open, so every opening starts from the entity as it now is.
          key={isSettingsOpen ? `settings-${view.entity.entityId}` : 'settings-shut'}
          entity={view.entity}
          isOpen={isSettingsOpen}
          onClose={() => {
            showSettings(false);
          }}
          canEdit={view.canEdit}
          canCreateTags={view.canCreateTags}
        />
      )}
    </>
  );
}
