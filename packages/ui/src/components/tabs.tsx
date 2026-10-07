/**
 * The tabs of a page: Overview, Devices, Configuration.
 *
 * A row of text tabs on a 1px rule, the current one in `foreground` at weight 500 over a 2px
 * `primary` line, the others in `foreground-muted`; a count sits beside its label in a small mono
 * pill. What the page shows under the row is the page's: it renders each panel with
 * {@link TabPanel} so the tab and its panel name each other.
 *
 * Arrow keys move along the row and choose as they go, Home and End jump to the ends: one tab
 * stop for the whole row, as a tab list is read.
 */
import { useRef, type KeyboardEvent, type ReactNode } from 'react';

import { cn } from '../lib/cn.js';

/** One tab. */
export type TabItem<TId extends string> = {
  /** What the page calls it: the panel it opens, and what the address remembers. */
  readonly id: TId;

  /** What it says. */
  readonly label: ReactNode;

  /** A count beside the label, when the tab holds a list. */
  readonly count?: number | string;
};

/** What the tabs need. */
export type TabsProps<TId extends string> = {
  /** The tabs, in the order they read. */
  readonly items: readonly TabItem<TId>[];

  /** The tab chosen. */
  readonly value: TId;

  /** Called with the tab chosen. */
  readonly onChange: (id: TId) => void;

  /** What the row is, for a screen reader: "Integration". */
  readonly label: string;

  /** What ties each tab to its panel: one per page, shared with {@link TabPanel}. */
  readonly idPrefix: string;

  /** On the right of the row: what acts on every tab. */
  readonly aside?: ReactNode;

  /** Anything extra for the outer element. */
  readonly className?: string;
};

/**
 * The id of a tab.
 *
 * @param prefix - The page's prefix.
 * @param id - The tab.
 * @returns The element id.
 */
function tabElementId(prefix: string, id: string): string {
  return `${prefix}-tab-${id}`;
}

/**
 * The id of a tab's panel.
 *
 * @param prefix - The page's prefix.
 * @param id - The tab.
 * @returns The element id.
 */
function panelElementId(prefix: string, id: string): string {
  return `${prefix}-panel-${id}`;
}

/**
 * Renders the row of tabs.
 *
 * @param props - See {@link TabsProps}.
 * @returns The tab list.
 */
export function Tabs<TId extends string>(props: TabsProps<TId>) {
  const { items, value, onChange, label, idPrefix, aside, className } = props;
  const row = useRef<HTMLDivElement>(null);

  /**
   * Moves to a tab by the keyboard, and chooses it.
   *
   * @param event - The key pressed on a tab.
   * @param index - The tab it was pressed on.
   */
  const move = (event: KeyboardEvent<HTMLButtonElement>, index: number): void => {
    const last = items.length - 1;
    const next =
      event.key === 'ArrowRight'
        ? index === last
          ? 0
          : index + 1
        : event.key === 'ArrowLeft'
          ? index === 0
            ? last
            : index - 1
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? last
              : null;
    const item = next === null ? undefined : items[next];

    if (item === undefined) {
      return;
    }

    event.preventDefault();
    onChange(item.id);
    row.current?.querySelector<HTMLButtonElement>(`#${tabElementId(idPrefix, item.id)}`)?.focus();
  };

  return (
    <div
      className={cn('flex items-center justify-between gap-4 border-b border-border', className)}
    >
      <div ref={row} role="tablist" aria-label={label} className="flex min-w-0 overflow-x-auto">
        {items.map((item, index) => {
          const isCurrent = item.id === value;

          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              id={tabElementId(idPrefix, item.id)}
              aria-selected={isCurrent}
              aria-controls={panelElementId(idPrefix, item.id)}
              tabIndex={isCurrent ? 0 : -1}
              onClick={() => {
                onChange(item.id);
              }}
              onKeyDown={(event) => {
                move(event, index);
              }}
              className={cn(
                'mr-5.5 flex h-10.5 shrink-0 items-center gap-2 border-b-2 px-0.5 text-ui whitespace-nowrap transition-colors',
                'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary',
                isCurrent
                  ? 'border-primary font-medium text-foreground'
                  : 'border-transparent text-foreground-muted hover:text-foreground',
              )}
            >
              {item.label}
              {item.count === undefined ? null : (
                <span className="rounded-pill bg-surface-raised px-1.75 font-mono text-mono-caption font-normal text-foreground-subtle tabular">
                  {item.count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {aside === undefined ? null : <div className="flex items-center gap-2">{aside}</div>}
    </div>
  );
}

/** What a panel needs. */
export type TabPanelProps = {
  /** The page's prefix, as given to {@link Tabs}. */
  readonly idPrefix: string;

  /** The tab it belongs to. */
  readonly id: string;

  /** What the tab shows. */
  readonly children: ReactNode;

  /** Anything extra for the outer element. */
  readonly className?: string;
};

/**
 * Renders what one tab shows, named by its tab.
 *
 * @param props - See {@link TabPanelProps}.
 * @returns The panel.
 */
export function TabPanel(props: TabPanelProps) {
  const { idPrefix, id, children, className } = props;

  return (
    <div
      role="tabpanel"
      id={panelElementId(idPrefix, id)}
      aria-labelledby={tabElementId(idPrefix, id)}
      className={className}
    >
      {children}
    </div>
  );
}
