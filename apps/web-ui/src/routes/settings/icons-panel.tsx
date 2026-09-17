/**
 * The icons settings: the catalogue, listed, with what the owner may do about each icon.
 *
 * Every icon the platform shows - a device's, an area's, the interface's own chrome - is one of
 * these, addressed by id. Changing what an id draws here changes it everywhere at once, which
 * is the point: a house whose lights are all `light` gets a new light icon in one place. The
 * built-in icons are marked as the interface's when the chrome draws itself with them, and as
 * modified when the owner has redrawn them; the owner's own are marked custom.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import type { IconView } from '@nebula-home/contracts';
import { Badge, Button, CatalogueIcon, Panel, TextField, UI_ICON_IDS } from '@nebula-home/ui';

import { useSession } from '@/auth/session-store';
import { useDebounced } from '@/lib/use-debounced';
import { fetchIcons, LIBRARY_QUERY_KEYS } from '@/library/api';
import { IconEditorModal, type IconEditorTarget } from '@/routes/settings/icon-editor-modal';

/** How many icons the list shows at most. */
const PAGE = 200;

/** The ids the interface draws itself with, for the badge. */
const INTERFACE_IDS: ReadonlySet<string> = new Set(UI_ICON_IDS);

/**
 * One icon in the list.
 *
 * @param props - The icon and what clicking it does.
 * @param props.icon - The icon.
 * @param props.onOpen - Opens it in the editor.
 * @returns The row.
 */
function IconRow(props: { readonly icon: IconView; readonly onOpen: () => void }) {
  const { icon, onOpen } = props;

  return (
    <li className="border-b border-border-soft last:border-b-0">
      <button
        type="button"
        className="grid w-full grid-cols-[32px_minmax(0,1fr)_auto] items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-surface-lit focus-visible:ring-3 focus-visible:ring-primary/25 focus-visible:outline-none"
        onClick={onOpen}
      >
        <CatalogueIcon node={icon.node} frame={icon.frame} size={24} className="text-foreground" />
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate text-ui font-medium text-foreground">{icon.name}</span>
          <span className="truncate font-mono text-caption text-foreground-subtle">{icon.id}</span>
        </span>
        <span className="flex items-center gap-1.5">
          {INTERFACE_IDS.has(icon.id) ? (
            <Badge tone="accent" size="small">
              Interface
            </Badge>
          ) : null}
          {icon.origin === 'custom' ? (
            <Badge tone="neutral" size="small">
              Custom
            </Badge>
          ) : icon.isOverridden ? (
            <Badge tone="warning" size="small">
              Modified
            </Badge>
          ) : null}
        </span>
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
  });

  /**
   * Shuts the editor and reads the catalogue again: every page draws from it.
   */
  const settle = (): void => {
    setEditing(null);
    void queryClient.invalidateQueries({ queryKey: LIBRARY_QUERY_KEYS.icons });
  };

  return (
    <div className="flex flex-col gap-5">
      <p className="text-ui text-foreground-muted">
        Every icon the house shows is one of these, by id. Redraw one and it changes everywhere it
        is used; add your own for the things the set has no drawing for.
      </p>

      <Panel
        title="Icons"
        action={
          <div className="flex items-center gap-2.5">
            <TextField
              label="Search icons"
              isLabelHidden
              size="compact"
              type="search"
              placeholder="Search icons…"
              className="w-44 lg:w-64"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
              }}
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
        {icons.isPending ? (
          <p className="px-4 py-3.5 text-ui text-foreground-muted">Loading…</p>
        ) : icons.error !== null ? (
          <p role="alert" className="px-4 py-3.5 text-ui text-danger">
            The catalogue could not be read.
          </p>
        ) : icons.data.length === 0 ? (
          <p className="px-4 py-3.5 text-ui text-foreground-muted">Nothing matches.</p>
        ) : (
          <ul>
            {icons.data.map((icon) => (
              <IconRow
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
