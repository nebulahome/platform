/**
 * Configuration › Dashboards: every dashboard in the house, who each is shown to, and the way
 * into laying each out.
 *
 * Only for whoever holds `dashboard:manage` - the route and the rail both check. A row is a
 * dashboard: its name and icon, how many cards it holds, the people it is shown to, and when it
 * last changed. **Edit layout** opens the editor, where the cards are placed; the spanner opens
 * the dialog for everything else - the name, the icon, who sees it, the file, and removing it.
 * What is saved here is what every person it is assigned to finds on their Dashboards page.
 */
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import type { DashboardAssignee, DashboardView } from '@nebulahome/contracts';
import { AppIcon, Button, IconButton } from '@nebulahome/ui';

import { Avatar } from '@/components/avatar';
import { WrenchIcon } from '@/components/icons';
import { DASHBOARD_QUERY_KEYS, fetchAssignees, fetchManagedDashboards } from '@/dashboard/api';
import { allCards } from '@/dashboard/dashboard-layout';
import { translate } from '@/i18n/messages';
import { relativeTime } from '@/lib/format-time';
import { matchesQuery } from '@/lib/search-text';
import { nonDefault, useListState, type ListCodec } from '@/lib/use-list-state';
import { DashboardDialog, type DashboardDialogTarget } from '@/routes/dashboard/dashboard-dialog';
import { DASHBOARDS_CONFIGURATION_PATH } from '@/routes/dashboard/dashboard-page';
import { useDashboardData } from '@/routes/dashboard/use-dashboard-data';
import { DeviceIcon, useCatalogueIcons } from '@/routes/library/device-icon';
import { LibraryPage } from '@/routes/library/library-page';
import { NoMatches } from '@/routes/library/no-matches';
import { SearchField } from '@/routes/library/search-field';

/** The column widths, shared by the header and every row so they line up. */
const COLUMNS =
  'grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 ' +
  'md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_104px_auto]';

/** How many faces a row shows before it counts the rest. */
const FACES_SHOWN = 4;

/** How the page's search lives in the address. */
const SEARCH_CODEC: ListCodec<string> = {
  keys: ['q'],

  /**
   * Reads the search.
   *
   * @param params - The query.
   * @returns What was typed.
   */
  read: (params) => params.get('q') ?? '',

  /**
   * Writes the search, when there is one.
   *
   * @param search - What was typed.
   * @returns The query entries.
   */
  write: (search) => nonDefault({ q: [search, ''] }),
};

/**
 * The editor's address for a dashboard.
 *
 * @param dashboardId - Which one.
 * @returns The path.
 */
export function dashboardEditorPath(dashboardId: string): string {
  return `${DASHBOARDS_CONFIGURATION_PATH}/${dashboardId}/edit`;
}

/** What the faces in a row need. */
type AssigneeFacesProps = {
  readonly userIds: readonly string[];
  readonly people: ReadonlyMap<string, DashboardAssignee>;
};

/**
 * The people a dashboard is shown to, as a row of faces with their names on hover.
 *
 * @param props - See {@link AssigneeFacesProps}.
 * @returns The faces, or a word for nobody.
 */
function AssigneeFaces(props: AssigneeFacesProps) {
  const { t } = useTranslation();

  const { userIds, people } = props;
  const named = userIds.flatMap((id) => {
    const person = people.get(id);

    return person === undefined ? [] : [person];
  });

  if (named.length === 0) {
    return (
      <span className="text-caption text-foreground-subtle">
        {t('dashboard.dashboardsManage.nobody', 'Nobody')}
      </span>
    );
  }

  const shown = named.slice(0, FACES_SHOWN);

  return (
    <span
      className="flex items-center gap-2"
      title={named.map((person) => person.displayName).join(', ')}
    >
      <span className="flex -space-x-2">
        {shown.map((person) => (
          <Avatar
            key={person.id}
            displayName={person.displayName}
            avatarUrl={person.avatarUrl}
            className="ring-2 ring-surface"
          />
        ))}
      </span>
      <span className="truncate text-caption text-foreground-muted">
        {named.length === 1
          ? (named[0]?.displayName ?? '')
          : t('dashboard.dashboardsManage.countPeople', '{{count}} people', {
              count: named.length,
            })}
      </span>
    </span>
  );
}

/**
 * Renders the page.
 *
 * @returns The page.
 */
export function DashboardsManagePage() {
  const { t } = useTranslation();

  const navigate = useNavigate();
  const [search, setSearch] = useListState(SEARCH_CODEC);
  const [dialog, setDialog] = useState<DashboardDialogTarget | null>(null);

  const dashboards = useQuery({
    queryKey: DASHBOARD_QUERY_KEYS.managed,
    /**
     * Reads every dashboard in the house.
     *
     * @param context - What TanStack Query provides, including the cancellation signal.
     * @param context.signal - Cancels the request when the page goes away.
     * @returns The dashboards.
     */
    queryFn: async ({ signal }: { signal: AbortSignal }) => fetchManagedDashboards(signal),
  });

  const assignees = useQuery({
    queryKey: DASHBOARD_QUERY_KEYS.assignees,
    /**
     * Reads the people, for the faces in each row.
     *
     * @param context - What TanStack Query provides, including the cancellation signal.
     * @param context.signal - Cancels the request when the page goes away.
     * @returns Every active account.
     */
    queryFn: async ({ signal }: { signal: AbortSignal }) => fetchAssignees(signal),
  });

  // What this house has, for the preview of a file about to be imported.
  const house = useDashboardData(undefined);
  const all = dashboards.data ?? [];
  const people = new Map((assignees.data ?? []).map((person) => [person.id, person]));
  const icons = useCatalogueIcons(all.map((dashboard) => dashboard.icon));
  const shown = all.filter((dashboard) =>
    matchesQuery(
      [dashboard.name, ...dashboard.userIds.map((id) => people.get(id)?.displayName ?? null)],
      search,
    ),
  );

  /**
   * Opens a dashboard's dialog.
   *
   * @param dashboard - Which one.
   */
  const configure = (dashboard: DashboardView): void => {
    setDialog({ mode: 'edit', dashboard });
  };

  return (
    <>
      <LibraryPage
        title={t('dashboard.dashboardsManage.dashboards', 'Dashboards')}
        counted={(count) =>
          translate('dashboard.count', {
            count,
            defaultValue_one: '{{count}} dashboard',
            defaultValue_other: '{{count}} dashboards',
          })
        }
        count={dashboards.isPending ? undefined : all.length}
        shownCount={shown.length}
        tools={
          all.length === 0 ? undefined : (
            <SearchField
              placeholder={t(
                'dashboard.dashboardsManage.searchDashboardsPeople',
                'Search dashboards, people…',
              )}
              value={search}
              onChange={setSearch}
            />
          )
        }
        action={
          <Button
            onClick={() => {
              setDialog({ mode: 'create' });
            }}
          >
            <AppIcon id="plus" size={15} />
            {t('dashboard.dashboardsManage.newDashboard', 'New dashboard')}
          </Button>
        }
        isPending={dashboards.isPending}
        error={dashboards.error}
        isEmpty={all.length === 0}
        emptyMessage={t(
          'dashboard.dashboardsManage.noDashboardYetMake',
          'No dashboard yet. Make one, lay its cards out, and choose who sees it on their Dashboards page.',
        )}
      >
        <div className="overflow-hidden rounded-panel border border-border bg-surface">
          <div
            className={`${COLUMNS} border-b border-border px-4 py-2.5 font-mono text-label text-foreground-subtle uppercase`}
            aria-hidden="true"
          >
            <span>{t('dashboard.dashboardsManage.dashboard', 'Dashboard')}</span>
            <span className="hidden md:block">
              {t('dashboard.dashboardsManage.shownTo', 'Shown to')}
            </span>
            <span className="hidden md:block">
              {t('dashboard.dashboardsManage.changed', 'Changed')}
            </span>
            <span />
          </div>

          {shown.length === 0 ? (
            <div className="p-4">
              <NoMatches
                query={search}
                onClear={() => {
                  setSearch('');
                }}
              />
            </div>
          ) : (
            <ul>
              {shown.map((dashboard) => {
                const cards = allCards(dashboard.layout).length;

                return (
                  <li
                    key={dashboard.id}
                    className={`${COLUMNS} border-b border-border px-4 py-3 last:border-b-0`}
                  >
                    <span className="flex min-w-0 items-center gap-3">
                      <DeviceIcon
                        icon={icons.get(dashboard.icon ?? '')}
                        className="text-foreground-muted"
                      />
                      <span className="flex min-w-0 flex-col gap-0.5">
                        <span className="truncate text-title font-medium text-foreground">
                          {dashboard.name}
                        </span>
                        <span className="text-caption text-foreground-subtle tabular">
                          {t('dashboard.cards.count', {
                            count: cards,
                            defaultValue_one: '{{count}} card',
                            defaultValue_other: '{{count}} cards',
                          })}
                        </span>
                      </span>
                    </span>

                    <span className="hidden min-w-0 md:block">
                      <AssigneeFaces userIds={dashboard.userIds} people={people} />
                    </span>

                    <span className="hidden text-ui text-foreground-subtle tabular md:block">
                      {relativeTime(dashboard.updatedAt)}
                    </span>

                    <span className="flex items-center justify-end gap-1.5">
                      <Button
                        variant="ghost"
                        size="compact"
                        aria-label={t(
                          'dashboard.dashboardsManage.editTheLayoutOf',
                          'Edit the layout of {{name}}',
                          { name: dashboard.name },
                        )}
                        onClick={() => {
                          void navigate(dashboardEditorPath(dashboard.id));
                        }}
                      >
                        <AppIcon id="pencil" size={14} />
                        <span className="hidden sm:inline">
                          {t('dashboard.dashboardsManage.editLayout', 'Edit layout')}
                        </span>
                      </Button>
                      <IconButton
                        variant="bare"
                        size="small"
                        label={t('dashboard.dashboardsManage.configureName', 'Configure {{name}}', {
                          name: dashboard.name,
                        })}
                        onClick={() => {
                          configure(dashboard);
                        }}
                      >
                        <WrenchIcon width="16" height="16" />
                      </IconButton>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </LibraryPage>

      <DashboardDialog
        key={dialog === null ? 'shut' : dialog.mode === 'edit' ? dialog.dashboard.id : 'new'}
        target={dialog}
        onClose={() => {
          setDialog(null);
        }}
        hasEntity={(entityId) => house.entityById.has(entityId)}
        hasScene={(sceneId) => house.sceneById.has(sceneId)}
        onSaved={(saved) => {
          const isNew = dialog?.mode === 'create';

          setDialog(null);

          // A dashboard just made is laid out next; one just renamed stays on the list.
          if (isNew && saved.layout.cards.length === 0) {
            void navigate(dashboardEditorPath(saved.id));
          }
        }}
        onDeleted={() => {
          setDialog(null);
        }}
      />
    </>
  );
}
