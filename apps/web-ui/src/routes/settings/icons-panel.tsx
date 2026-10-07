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

import type { IconView } from '@nebulahome/contracts';
import {
  Badge,
  Button,
  CatalogueIcon,
  Panel,
  PanelNote,
  TabPanel,
  Tabs,
  UI_ICON_IDS,
} from '@nebulahome/ui';

import { useSession } from '@/auth/session-store';
import { useDebounced } from '@/lib/use-debounced';
import { fetchIcons, LIBRARY_QUERY_KEYS } from '@/library/api';
import { NoMatches } from '@/routes/library/no-matches';
import { SearchField } from '@/routes/library/search-field';
import { IconEditorModal, type IconEditorTarget } from '@/routes/settings/icon-editor-modal';

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
  const { icon, onOpen } = props;
  const marks = [
    INTERFACE_IDS.has(icon.id) ? (
      <Badge key="interface" tone="accent" size="small">
        Interface
      </Badge>
    ) : null,
    icon.origin === 'custom' ? (
      <Badge key="custom" tone="neutral" size="small">
        Custom
      </Badge>
    ) : icon.isOverridden ? (
      <Badge key="modified" tone="warning" size="small">
        Modified
      </Badge>
    ) : null,
  ].filter((mark) => mark !== null);

  return (
    <li>
      <button
        type="button"
        title={icon.id}
        className="flex h-full w-full flex-col items-center gap-2 rounded-field border border-border bg-surface px-2 pt-4 pb-3 text-center transition-[border-color,box-shadow] hover:border-border-strong focus-visible:ring-3 focus-visible:ring-primary/25 focus-visible:outline-none"
        onClick={onOpen}
      >
        <CatalogueIcon node={icon.node} frame={icon.frame} size={28} className="text-foreground" />
        <span className="flex w-full min-w-0 flex-col gap-0.5">
          <span className="truncate text-ui font-medium text-foreground">{icon.name}</span>
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
    <div className="flex flex-col gap-5">
      <Panel
        title="Icons"
        action={
          <div className="flex items-center gap-2.5">
            <SearchField
              label="Search icons"
              placeholder="Search icons…"
              className="w-44 lg:w-64"
              value={search}
              onChange={setSearch}
            />
            {canWrite ? (
              <Button
                size="compact"
                onClick={() => {
                  setEditing({ mode: 'create' });
                }}
              >
                New icon
              </Button>
            ) : null}
          </div>
        }
      >
        <div className="border-t border-border px-4 pt-3">
          <Tabs
            label="Which icons"
            idPrefix="icons"
            value={scope}
            onChange={setScope}
            items={[
              { id: 'all', label: 'All' },
              { id: 'interface', label: 'Interface' },
              { id: 'custom', label: 'Custom' },
            ]}
          />
          {scope === 'interface' ? (
            <p className="pt-3 text-caption text-foreground-subtle">
              The icons the interface draws itself with. Drawing one afresh changes it everywhere.
            </p>
          ) : null}
        </div>
        <TabPanel idPrefix="icons" id={scope}>
          {icons.isPending ? (
            <p className="px-4 py-3.5 text-ui text-foreground-muted">Loading…</p>
          ) : icons.error !== null ? (
            <p role="alert" className="px-4 py-3.5 text-ui text-danger">
              The catalogue could not be read.
            </p>
          ) : icons.data.length === 0 ? (
            query === '' ? (
              <p className="px-4 py-3.5 text-ui text-foreground-muted">The catalogue is empty.</p>
            ) : (
              <div className="p-4">
                <NoMatches
                  query={query}
                  onClear={() => {
                    setSearch('');
                  }}
                />
              </div>
            )
          ) : shown.length === 0 ? (
            <p className="px-4 py-3.5 text-ui text-foreground-muted">
              {scope === 'custom' ? 'No icons of your own yet.' : 'None of these icons match.'}
            </p>
          ) : (
            <ul
              aria-label="Icons"
              className="grid grid-cols-3 gap-2.5 p-4 sm:grid-cols-4 lg:grid-cols-6"
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
        </TabPanel>
        {icons.data !== undefined && icons.data.length >= PAGE ? (
          <PanelNote>
            The first {PAGE} are shown. Search to find the rest of the catalogue.
          </PanelNote>
        ) : null}
      </Panel>

      <IconEditorModal
        // Keyed on the target, so the editor is a fresh one each time it opens.
        key={editing === null ? 'shut' : editing.mode === 'create' ? 'create' : editing.icon.id}
        target={editing}
        onClose={() => {
          setEditing(null);
        }}
        onSaved={settle}
      />
    </div>
  );
}
