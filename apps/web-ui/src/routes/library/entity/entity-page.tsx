/**
 * One entity's own page: what it is doing now, what it has done, and the facts about it.
 *
 * A page rather than a dialog, because it holds three different things and each needs room: the
 * controls for whatever the entity can be told, a chart of its past, and the facts about it. What
 * it is called, drawn as and tagged with is a dialog behind the settings button in the header -
 * the way a device's is on its page - and `?settings` in the address opens the page with it open,
 * which is where the spanner on an entity's row leads.
 *
 * The header names where it is the way the navigation does: Devices, then the device it belongs
 * to, then the entity. The device's name is a link to the device's page. Under the facts, what
 * else in the house names it - the automations, scenes and aliases it takes part in.
 */
import { useParams, useSearchParams } from 'react-router';

import { AppIcon, Badge, IconButton } from '@nebulahome/ui';

import { toMessage } from '@/lib/error-message';
import { entityKindOf } from '@/library/entity-kind';
import { isActiveState } from '@/library/history-series';
import { useLive } from '@/live/live-store';
import { DetailHeader, DetailPlaceholder, type Crumb } from '@/routes/library/detail-page';
import { devicePath } from '@/routes/library/device/device-path';
import { ControlPanel } from '@/routes/library/entity/controls/control-panel';
import { CorrelationsPanel } from '@/routes/library/entity/correlations-panel';
import { DetailsPanel } from '@/routes/library/entity/details-panel';
import { ENTITY_SETTINGS_PARAM } from '@/routes/library/entity/entity-path';
import { EntitySettingsDialog } from '@/routes/library/entity/entity-settings-dialog';
import { HistoryPanel } from '@/routes/library/entity/history-panel';
import { useEntityPage, type EntityPageView } from '@/routes/library/entity/use-entity-page';
import { EntityTile } from '@/routes/library/entity-tile';

/** What the summary needs. */
type EntitySummaryProps = {
  readonly view: EntityPageView;
};

/**
 * The entity at a glance: its tile, its name, what it is and where, and whether it is there.
 *
 * @param props - See {@link EntitySummaryProps}.
 * @returns The summary.
 */
function EntitySummary(props: EntitySummaryProps) {
  const { view } = props;
  const liveStatus = useLive((state) => state.status);
  const { entity, reading, state, room, floor, icons } = view;
  const kind = entityKindOf(entity);
  const place = [floor?.name, room?.name ?? entity.areaName].filter(Boolean).join(' › ');

  return (
    <section className="flex flex-wrap items-center gap-4">
      <EntityTile
        size="large"
        icon={entity.icon === null ? undefined : icons.get(entity.icon)}
        kind={kind}
        isActive={isActiveState(state)}
        isAvailable={reading.isAvailable}
      />
      <div className="flex min-w-0 grow flex-col gap-1">
        <h2 className="truncate text-headline font-semibold tracking-tight">{entity.name}</h2>
        <p className="text-ui text-foreground-muted">
          {kind.label}
          {place === '' ? null : <span className="text-foreground-subtle"> · {place}</span>}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Badge tone={reading.isAvailable ? 'success' : 'warning'}>
          {reading.isAvailable ? 'Reachable' : 'Unreachable'}
        </Badge>
        {liveStatus === 'live' ? (
          <Badge tone="neutral">Live</Badge>
        ) : (
          <Badge tone="neutral">{liveStatus === 'connecting' ? 'Connecting' : 'Not live'}</Badge>
        )}
      </div>
    </section>
  );
}

/**
 * Renders an entity's page.
 *
 * @returns The page.
 */
export function EntityPage() {
  const { entityId = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const isSettingsOpen = params.has(ENTITY_SETTINGS_PARAM);
  const { view, isPending, error } = useEntityPage(entityId);
  const crumbs: Crumb[] = [
    { to: '/devices', label: 'Devices' },
    ...(view?.device === undefined
      ? []
      : [{ to: devicePath(view.device.id), label: view.device.name }]),
  ];

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

  return (
    <div className="flex min-h-0 grow flex-col">
      <DetailHeader
        crumbs={crumbs}
        title={view?.entity.name ?? entityId}
        actions={
          view === undefined ? undefined : (
            <IconButton
              variant="raised"
              label={`Configure ${view.entity.name}`}
              onClick={() => {
                showSettings(true);
              }}
            >
              <AppIcon id="settings" size={15} />
            </IconButton>
          )
        }
      />

      <div className="min-h-0 grow overflow-y-auto px-8 pt-5 pb-7">
        <div className="mx-auto flex max-w-7xl flex-col gap-5">
          {view === undefined ? (
            isPending ? (
              <DetailPlaceholder>Reading…</DetailPlaceholder>
            ) : (
              <DetailPlaceholder isProblem>{toMessage(error)}</DetailPlaceholder>
            )
          ) : (
            <>
              <EntitySummary view={view} />
              <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
                <div className="flex min-w-0 flex-col gap-5">
                  <ControlPanel
                    entity={view.entity}
                    state={view.state}
                    reportedAt={view.reportedAt}
                    reading={view.reading}
                    canControl={view.canControl}
                  />
                  <HistoryPanel
                    entity={view.entity}
                    reading={view.reading}
                    current={view.live?.state ?? view.entity.state}
                  />
                </div>
                <div className="flex min-w-0 flex-col gap-5">
                  <DetailsPanel view={view} />
                  <CorrelationsPanel entityId={view.entity.entityId} />
                </div>
              </div>
            </>
          )}
        </div>
      </div>

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
    </div>
  );
}
