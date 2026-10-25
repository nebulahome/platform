/**
 * Choosing an icon from the catalogue: a popover under the icon button that asked for it.
 *
 * A search over the whole catalogue, drawn as a grid of the icons themselves - a name like
 * `radar` says less about a sensor than the drawing does - in two groups: the owner's own
 * (Custom) first, then the platform's (System: its own ids first, then everything lucide ships).
 * The footer names the icon under the pointer or the focus, else the one chosen. Picking one hands
 * it back and closes; what the id draws is the catalogue's business, so a row keeps the id.
 *
 * Every field that takes an icon - a device, an entity, an area, a scene, a tag, a dashboard, a
 * role - opens this one, through {@link NameIconField}.
 *
 * Keyboard: the search has the focus on opening; Down moves into the grid, the arrows move along
 * it (eight to a row), Enter picks, Escape closes.
 */
import { useQuery } from '@tanstack/react-query';
import { useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';

import type { IconView } from '@nebulahome/contracts';
import { AppIcon, CatalogueIcon, cn, Popover } from '@nebulahome/ui';

import { useDebounced } from '@/lib/use-debounced';
import { fetchIcons, LIBRARY_QUERY_KEYS } from '@/library/api';

/** How many icons one search shows at most. */
const PAGE = 120;

/** Icons to a row of the grid. */
const COLUMNS = 8;

/** The popover's width: eight 40px buttons, their gaps and the padding. */
const WIDTH = 372;

/** How far each arrow key moves the focus along the grid. */
const STEPS: Readonly<Record<string, number>> = {
  ArrowLeft: -1,
  ArrowRight: 1,
  ArrowUp: -COLUMNS,
  ArrowDown: COLUMNS,
};

/** What the picker needs. */
export type IconPickerProps = {
  /** The icon button it hangs off. */
  readonly anchor: RefObject<HTMLElement | null>;

  /** Whether it is showing. */
  readonly isOpen: boolean;

  /** Called on Escape or a press outside. */
  readonly onClose: () => void;

  /** The id chosen so far, drawn as selected. */
  readonly current: string | null;

  /** Called with the icon picked. */
  readonly onPick: (icon: IconView) => void;
};

/**
 * Renders the picker.
 *
 * @param props - See {@link IconPickerProps}.
 * @returns The popover.
 */
export function IconPicker(props: IconPickerProps) {
  const { t } = useTranslation();
  const { anchor, isOpen, onClose, current, onPick } = props;
  const [search, setSearch] = useState('');
  const [hovered, setHovered] = useState<IconView | undefined>(undefined);
  const grid = useRef<HTMLDivElement>(null);
  const query = useDebounced(search.trim());

  const icons = useQuery({
    queryKey: [...LIBRARY_QUERY_KEYS.icons, 'search', query],
    /**
     * Reads a page of the catalogue for what was typed.
     *
     * @param context - What TanStack Query provides, including the cancellation signal.
     * @param context.signal - Cancels the request when the search moves on.
     * @returns The icons.
     */
    queryFn: async ({ signal }: { signal: AbortSignal }) =>
      fetchIcons({ q: query, limit: PAGE }, signal),
    enabled: isOpen,
  });

  const found = icons.data ?? [];
  const groups = [
    {
      key: 'custom',
      title: t('library.iconPicker.custom', 'Custom'),
      items: found.filter((icon) => icon.origin === 'custom'),
    },
    {
      key: 'system',
      title: t('library.iconPicker.system', 'System'),
      items: found.filter((icon) => icon.origin !== 'custom'),
    },
  ].filter((group) => group.items.length > 0);
  const named = hovered ?? found.find((icon) => icon.id === current);

  /**
   * Moves the focus along the grid.
   *
   * @param event - The key press, on a grid button.
   */
  const onGridKey = (event: KeyboardEvent<HTMLDivElement>): void => {
    const step = STEPS[event.key];

    if (step === undefined || grid.current === null) {
      return;
    }

    const buttons = [...grid.current.querySelectorAll<HTMLButtonElement>('button')];
    const at = buttons.indexOf(globalThis.document.activeElement as HTMLButtonElement);

    event.preventDefault();
    buttons[Math.max(0, Math.min(buttons.length - 1, at + step))]?.focus();
  };

  /** Closes, forgetting the search. */
  const close = (): void => {
    setSearch('');
    setHovered(undefined);
    onClose();
  };

  return (
    <Popover
      anchor={anchor}
      isOpen={isOpen}
      onClose={close}
      label={t('library.iconPicker.chooseAnIcon', 'Choose an icon')}
      width={WIDTH}
    >
      <label className="flex h-11 shrink-0 items-center gap-2.5 border-b border-border-strong px-3.5 text-foreground-subtle">
        <AppIcon id="search" size={16} />
        <input
          type="search"
          // eslint-disable-next-line jsx-a11y/no-autofocus -- opening the picker is asking to search it.
          autoFocus
          value={search}
          aria-label={t('library.iconPicker.searchIcons', 'Search icons')}
          placeholder={t('library.iconPicker.searchIcons', 'Search icons')}
          onChange={(event) => {
            setSearch(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              grid.current?.querySelector<HTMLButtonElement>('button')?.focus();
            }
          }}
          className="min-w-0 grow bg-transparent text-ui text-foreground placeholder:text-foreground-subtle focus-visible:outline-none"
        />
      </label>

      {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions -- the arrows move between the buttons inside. */}
      <div
        ref={grid}
        onKeyDown={onGridKey}
        className="flex max-h-65 flex-col gap-2.5 overflow-y-auto px-2.5 pt-2.5 pb-3"
      >
        {icons.isPending ? (
          <p className="px-1 py-2 text-ui text-foreground-subtle">
            {t('library.iconPicker.looking', 'Looking…')}
          </p>
        ) : icons.isError ? (
          <p role="alert" className="px-1 py-2 text-ui text-danger">
            {t('library.iconPicker.catalogueCouldNotBe', 'The catalogue could not be read.')}
          </p>
        ) : groups.length === 0 ? (
          <p className="px-1 py-2 text-ui text-foreground-subtle">
            {t('library.iconPicker.nothingMatches', 'Nothing matches.')}
          </p>
        ) : (
          groups.map((group) => (
            <div key={group.key}>
              <div className="flex justify-between px-1 pt-0.5 pb-1.5 font-mono text-label text-foreground-subtle">
                <span className="uppercase">{group.title}</span>
                <span className="tabular">{group.items.length}</span>
              </div>
              <div role="listbox" aria-label={group.title} className="grid grid-cols-8 gap-1">
                {group.items.map((icon) => (
                  <button
                    key={icon.id}
                    type="button"
                    role="option"
                    aria-selected={icon.id === current}
                    aria-label={icon.name}
                    title={icon.name}
                    onClick={() => {
                      onPick(icon);
                      close();
                    }}
                    onPointerEnter={() => {
                      setHovered(icon);
                    }}
                    onPointerLeave={() => {
                      setHovered(undefined);
                    }}
                    onFocus={() => {
                      setHovered(icon);
                    }}
                    className={cn(
                      'press-scale flex size-10 items-center justify-center rounded-field border transition-colors duration-150',
                      'focus-visible:shadow-focus focus-visible:outline-none',
                      icon.id === current
                        ? 'border-primary bg-primary/14 text-primary'
                        : 'border-transparent text-foreground-muted hover:bg-surface-high hover:text-foreground focus-visible:bg-surface-high focus-visible:text-foreground',
                    )}
                  >
                    <CatalogueIcon node={icon.node} frame={icon.frame} size={18} />
                  </button>
                ))}
              </div>
            </div>
          ))
        )}
      </div>

      <div className="flex h-9 shrink-0 items-center gap-2 border-t border-border-strong px-3.5 text-caption">
        {named === undefined ? (
          <span className="grow" />
        ) : (
          <span className="flex min-w-0 grow items-center gap-2">
            <span className="text-primary">
              <CatalogueIcon node={named.node} frame={named.frame} size={14} />
            </span>
            <span className="truncate text-foreground">{named.name}</span>
            <span className="truncate font-mono text-foreground-subtle" translate="no">
              {named.id}
            </span>
          </span>
        )}
        <span className="shrink-0 text-foreground-subtle">
          {t('library.iconPicker.escToClose', 'Esc to close')}
        </span>
      </div>
    </Popover>
  );
}
