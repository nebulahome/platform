/**
 * One entity's own page: what it is doing now, what it has done, and what it is called.
 *
 * A page rather than a dialog, because it holds three different things and each needs room: the
 * controls for whatever the entity can be told, a chart of its past, and the facts about it. Two
 * views share the address - the overview and its settings - and the view is in the query, so a
 * link can open either and the back button walks between them.
 *
 * The header names where it is the way the navigation does: Devices, then the device it belongs
 * to, then the entity. The device's name is a link back to its row, opened.
 */
import { Link, useParams, useSearchParams } from 'react-router';

import { Badge, cn } from '@nebula-home/ui';

import { toMessage } from '@/lib/error-message';
import { entityKindOf } from '@/library/entity-kind';
import { isActiveState } from '@/library/history-series';
import { useLive } from '@/live/live-store';
import { ControlPanel } from '@/routes/library/entity/controls/control-panel';
import { DetailsPanel } from '@/routes/library/entity/details-panel';
import { ENTITY_TAB_PARAM, entityPath, type EntityTab } from '@/routes/library/entity/entity-path';
import { EntitySettingsForm } from '@/routes/library/entity/entity-settings-form';
import { HistoryPanel } from '@/routes/library/entity/history-panel';
import { useEntityPage, type EntityPageView } from '@/routes/library/entity/use-entity-page';
import { EntityTile } from '@/routes/library/entity-tile';

/** The two views, in the order the switch shows them. */
const TABS: readonly { readonly tab: EntityTab; readonly label: string }[] = [
  { tab: 'overview', label: 'Overview' },
  { tab: 'settings', label: 'Settings' },
];

/** What the header needs. */
type EntityHeaderProps = {
  readonly entityId: string;
  readonly name: string;
  readonly device: EntityPageView['device'];
  readonly tab: EntityTab;
};

/**
 * The page's header: where the entity is, and the switch between its two views.
 *
 * @param props - See {@link EntityHeaderProps}.
 * @returns The header.
 */
function EntityHeader(props: EntityHeaderProps) {
  const { entityId, name, device, tab } = props;

  return (
    <header className="flex min-h-17 shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-border px-6 py-2.5">
      <h1 className="flex min-w-0 items-center gap-2 text-head tracking-tight">
        <Link
          to="/devices"
          className="shrink-0 text-foreground-muted transition-colors hover:text-foreground"
        >
          Devices
        </Link>
        {device === undefined ? null : (
          <>
            <span aria-hidden="true" className="font-light text-foreground-subtle">
              /
            </span>
            <Link
              to={`/devices?device=${encodeURIComponent(device.id)}`}
              className="max-w-48 truncate text-foreground-muted transition-colors hover:text-foreground"
            >
              {device.name}
            </Link>
          </>
        )}
        <span aria-hidden="true" className="font-light text-foreground-subtle">
          /
        </span>
        <span className="truncate font-semibold">{name}</span>
      </h1>

      <nav
        aria-label="Views of this entity"
        className="flex shrink-0 items-center gap-1 rounded-full border border-border-soft face-sunk p-1"
      >
        {TABS.map((entry) => (
          <Link
            key={entry.tab}
            to={entityPath(entityId, entry.tab)}
            replace
            aria-current={entry.tab === tab ? 'page' : undefined}
            className={cn(
              'press flex h-7 items-center rounded-full px-3.5 text-ui transition-colors',
              entry.tab === tab
                ? 'face-pill font-medium text-foreground'
                : 'text-foreground-muted hover:text-foreground',
            )}
          >
            {entry.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}

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
 * A line where the page's content would be, while it is read or when it cannot be.
 *
 * @param props - What to say, and whether it is a failure.
 * @param props.children - The sentence.
 * @param props.isProblem - Whether it reports a failure rather than a wait.
 * @returns The placeholder.
 */
function Placeholder(props: { readonly children: string; readonly isProblem?: boolean }) {
  const { children, isProblem = false } = props;

  return (
    <div
      role={isProblem ? 'alert' : 'status'}
      className="rounded-panel border border-dashed border-border-strong px-6 py-8 text-center"
    >
      <p
        className={cn(
          'mx-auto max-w-md text-ui',
          isProblem ? 'text-danger' : 'text-foreground-muted',
        )}
      >
        {children}
      </p>
    </div>
  );
}

/**
 * Renders an entity's page.
 *
 * @returns The page.
 */
export function EntityPage() {
  const { entityId = '' } = useParams();
  const [params] = useSearchParams();
  const tab: EntityTab = params.get(ENTITY_TAB_PARAM) === 'settings' ? 'settings' : 'overview';
  const { view, isPending, error } = useEntityPage(entityId);

  return (
    <div className="flex min-h-0 grow flex-col">
      <EntityHeader
        entityId={entityId}
        name={view?.entity.name ?? entityId}
        device={view?.device}
        tab={tab}
      />

      <div className="min-h-0 grow overflow-y-auto p-6">
        <div className="mx-auto flex max-w-5xl flex-col gap-5">
          {view === undefined ? (
            isPending ? (
              <Placeholder>Reading…</Placeholder>
            ) : (
              <Placeholder isProblem>{toMessage(error)}</Placeholder>
            )
          ) : (
            <>
              <EntitySummary view={view} />
              {tab === 'settings' ? (
                <div className="max-w-2xl">
                  <EntitySettingsForm
                    key={view.entity.entityId}
                    entity={view.entity}
                    canEdit={view.canEdit}
                    canCreateTags={view.canCreateTags}
                  />
                </div>
              ) : (
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
                  <DetailsPanel view={view} />
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
