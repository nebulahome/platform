/**
 * The icons settings: the catalogue, laid out in tiles, with what the owner may do about each.
 *
 * Every icon the platform shows - a device's, an area's, a tag's, the interface's own chrome -
 * is one of these, addressed by id. Changing what an id draws here changes it everywhere at
 * once, which is the point: a house whose lights are all `light` gets a new light icon in one
 * place. The built-in icons are marked as the interface's when the chrome draws itself with
 * them, and as modified when the owner has redrawn them; the owner's own are marked custom.
 *
 * Tiles rather than rows, the same tiles as the picker in a device's dialog: a catalogue is
 * scanned by glyph, and a grid shows thirty glyphs where a list shows eight names. The name
 * sits under the drawing and the id under the name, so that what the picker offers and what
 * this page edits look like the same thing - because they are.
 */
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { IconView } from '@nebulahome/contracts';
import { AppIcon, Badge, Button, CatalogueIcon, Segmented, UI_ICON_IDS } from '@nebulahome/ui';

import { useSession } from '@/auth/session-store';
import { iconName } from '@/lib/icon-names';
import { useDebounced } from '@/lib/use-debounced';
import { fetchIcons, LIBRARY_QUERY_KEYS } from '@/library/api';
import { NoMatches } from '@/routes/library/no-matches';
import { SearchField } from '@/routes/library/search-field';
import { IconEditorModal, type IconEditorTarget } from '@/routes/settings/icon-editor-modal';
import { SettingsPage } from '@/routes/settings/settings-ui';

/** How many icons the list shows at most. */
const PAGE = 200;

/** The ids the interface draws itself with, for the badge. */
const INTERFACE_IDS: ReadonlySet<string> = new Set(UI_ICON_IDS);

/** Which part of the catalogue the grid shows: all of it, the interface's, or the owner's. */
type IconScope = 'all' | 'interface' | 'custom';

/**
 * Whether an icon belongs to a part of the catalogue.
 *
 * @param icon - The icon.
 * @param scope - The part.
 * @returns True when the grid shows it.
 */
function inScope(icon: IconView, scope: IconScope): boolean {
  if (scope === 'interface') {
    return INTERFACE_IDS.has(icon.id);
  }

  return scope === 'custom' ? icon.origin === 'custom' : true;
}

/**
 * One icon in the grid.
 *
 * @param props - The icon and what clicking it does.
 * @param props.icon - The icon.
 * @param props.onOpen - Opens it in the editor.
 * @returns The tile.
 */
function IconTile(props: { readonly icon: IconView; readonly onOpen: () => void }) {
  const { t } = useTranslation();
  const { icon, onOpen } = props;
  const isInterface = INTERFACE_IDS.has(icon.id);
  const marks = [
    icon.origin === 'custom' ? (
      <Badge key="custom" tone="neutral" size="small">
        {t('settings.icons.custom', 'Custom')}
      </Badge>
    ) : icon.isOverridden ? (
      <Badge key="modified" tone="warning" size="small">
        {t('settings.icons.modified', 'Modified')}
      </Badge>
    ) : null,
  ].filter((mark) => mark !== null);

  return (
    <li>
      <button
        type="button"
        title={icon.id}
        className="group relative flex h-full w-full flex-col items-center gap-2.5 rounded-card border border-border bg-surface px-2 pt-4 pb-3.5 text-center shadow-edge transition-[border-color,background-color,transform] duration-150 hover:-translate-y-px hover:border-border-strong hover:bg-surface-raised/40 focus-visible:ring-3 focus-visible:ring-primary/25 focus-visible:outline-none"
        onClick={onOpen}
      >
        {isInterface ? (
          <span className="absolute top-2.5 right-2.5 size-1.5 rounded-full bg-primary">
            <span className="sr-only">{t('settings.icons.interface', 'Interface')}</span>
          </span>
        ) : null}
        <span className="flex size-11 items-center justify-center rounded-tile bg-surface-raised text-foreground transition-colors group-hover:bg-surface-high">
          <CatalogueIcon node={icon.node} frame={icon.frame} size={20} />
        </span>
        <span className="flex w-full min-w-0 flex-col gap-1">
          <span className="truncate text-ui text-foreground">{iconName(icon.id, icon.name)}</span>
          <span className="truncate font-mono text-caption text-foreground-subtle">{icon.id}</span>
        </span>
        {marks.length === 0 ? null : (
          <span className="flex flex-wrap items-center justify-center gap-1">{marks}</span>
        )}
      </button>
    </li>
  );
}

/**
 * Renders the icons settings.
 *
 * @returns The panel.
 */
export function IconsPanel() {
  const { t } = useTranslation();
  const canWrite = useSession((state) => state.can)('settings:write');
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const query = useDebounced(search.trim());
  const [editing, setEditing] = useState<IconEditorTarget | null>(null);
  const [scope, setScope] = useState<IconScope>('all');

  const icons = useQuery({
    queryKey: [...LIBRARY_QUERY_KEYS.icons, 'settings', query],
    /**
     * Reads a page of the catalogue for what was typed.
     *
     * @param context - What TanStack Query provides, including the cancellation signal.
     * @param context.signal - Cancels the request when the search moves on.
     * @returns The icons.
     */
    queryFn: async ({ signal }: { signal: AbortSignal }) =>
      fetchIcons({ q: query, limit: PAGE }, signal),
    // The grid keeps the last answer on screen while the next query is read, rather than
    // flashing "Loading" at every pause in the typing.
    placeholderData: keepPreviousData,
  });

  const shown = (icons.data ?? []).filter((icon) => inScope(icon, scope));

  /**
   * Shuts the editor and reads the catalogue again: every page draws from it.
   */
  const settle = (): void => {
    setEditing(null);
    void queryClient.invalidateQueries({ queryKey: LIBRARY_QUERY_KEYS.icons });
  };

  return (
    <SettingsPage path="/settings/customise/icons">
      <div className="flex flex-wrap items-center gap-2">
        <Segmented
          label={t('settings.icons.which', 'Which icons')}
          value={scope}
          onChange={setScope}
          options={[
            { value: 'all', label: t('settings.icons.all', 'All') },
            { value: 'interface', label: t('settings.icons.interface', 'Interface') },
            { value: 'custom', label: t('settings.icons.custom', 'Custom') },
          ]}
        />
        <span className="grow" />
        <SearchField
          label={t('settings.icons.search', 'Search icons')}
          placeholder={t('settings.icons.searchPlaceholder', 'Search icons…')}
          className="w-55"
          value={search}
          onChange={setSearch}
        />
        {canWrite ? (
          <Button
            onClick={() => {
              setEditing({ mode: 'create' });
            }}
          >
            <AppIcon id="plus" size={16} />
            {t('settings.icons.new', 'New icon')}
          </Button>
        ) : null}
      </div>

      {scope === 'interface' ? (
        <p className="-mt-3 px-1 text-caption text-foreground-subtle">
          {t(
            'settings.icons.interfaceNote',
            'The icons the interface draws itself with. Drawing one afresh changes it everywhere.',
          )}
        </p>
      ) : null}

      {icons.isPending ? (
        <p className="text-ui text-foreground-muted">{t('common.loading', 'Loading…')}</p>
      ) : icons.error !== null ? (
        <p role="alert" className="text-ui text-danger">
          {t('settings.icons.unreadable', 'The catalogue could not be read.')}
        </p>
      ) : icons.data.length === 0 ? (
        query === '' ? (
          <p className="text-ui text-foreground-muted">
            {t('settings.icons.empty', 'The catalogue is empty.')}
          </p>
        ) : (
          <NoMatches
            query={query}
            onClear={() => {
              setSearch('');
            }}
          />
        )
      ) : shown.length === 0 ? (
        <p className="text-ui text-foreground-muted">
          {scope === 'custom'
            ? t('settings.icons.noCustom', 'No icons of your own yet.')
            : t('settings.icons.noMatch', 'None of these icons match.')}
        </p>
      ) : (
        <ul
          aria-label={t('settings.icons.list', 'Icons')}
          className="grid grid-cols-3 gap-2.5 sm:grid-cols-4 lg:grid-cols-6"
        >
          {shown.map((icon) => (
            <IconTile
              key={icon.id}
              icon={icon}
              onOpen={() => {
                if (canWrite) {
                  setEditing({ mode: 'edit', icon });
                }
              }}
            />
          ))}
        </ul>
      )}

      {icons.data !== undefined && icons.data.length >= PAGE ? (
        <p className="px-1 text-caption text-foreground-subtle">
          {t(
            'settings.icons.firstShown',
            'The first {{count}} are shown. Search to find the rest of the catalogue.',
            { count: PAGE },
          )}
        </p>
      ) : null}

      <IconEditorModal
        // Keyed on the target, so the editor is a fresh one each time it opens.
        key={editing === null ? 'shut' : editing.mode === 'create' ? 'create' : editing.icon.id}
        target={editing}
        onClose={() => {
          setEditing(null);
        }}
        onSaved={settle}
      />
    </SettingsPage>
  );
}
