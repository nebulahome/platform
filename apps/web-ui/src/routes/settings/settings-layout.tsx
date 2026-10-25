/**
 * The settings frame: the tree on the left, the page on the right.
 *
 * The left column (232px) is the title, the settings search and the tree from `settings-tree.ts`:
 * Personal pages as links, Server groups that open in place - the group of the current page open,
 * the others shut until pressed. The right column (at most 860px) is the page, which draws its
 * own breadcrumb and header through `SettingsPage`. The tree stays on the left; the page is
 * centred in the room beside it rather than stretched, so a row's control stays near its label.
 * On a narrow window the two columns wrap, the tree above the page.
 *
 * The scrolling container is `relative`, and that is load-bearing rather than decorative. A
 * visually hidden label - Tailwind's `sr-only` - is `position: absolute`, and an absolutely
 * positioned element is only clipped by an ancestor's `overflow` when that ancestor is also its
 * containing block. Without a positioned one, its containing block is the whole document: it
 * escapes this column, lands wherever its static position would have been, and stretches the
 * page with a second scrollbar nothing appears to own.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { NavLink, Outlet, useLocation } from 'react-router';

import { AppIcon, cn } from '@nebulahome/ui';

import { useSession } from '@/auth/session-store';
import { text } from '@/i18n/messages';
import { SettingsSearch } from '@/routes/settings/settings-search';
import { reachableTree, settingsPageAt, type SettingsGroup } from '@/routes/settings/settings-tree';

/** What one scope of the tree needs. */
type ScopeProps = {
  /** The heading: Personal, Server. */
  readonly title: string;

  /** Its entries. */
  readonly groups: readonly SettingsGroup[];

  /** The group the current page is in. */
  readonly activeId: string | undefined;

  /** The group opened or shut by hand on this page, overriding the default. */
  readonly toggled: { readonly id: string; readonly isOpen: boolean } | undefined;

  /** Called when a group's button is pressed. */
  readonly onToggle: (id: string, isOpen: boolean) => void;
};

/**
 * One scope of the tree: its heading with a hairline, then its entries.
 *
 * @param props - See {@link ScopeProps}.
 * @returns The scope, or nothing when every entry in it is out of reach.
 */
function Scope(props: ScopeProps) {
  const { title, groups, activeId, toggled, onToggle } = props;

  if (groups.length === 0) {
    return null;
  }

  return (
    <>
      <div className="flex items-center gap-2.5 px-2.5 pb-2 [&:not(:first-child)]:pt-4.5">
        <span className="font-mono text-label whitespace-nowrap text-foreground-subtle uppercase">
          {title}
        </span>
        <span aria-hidden="true" className="h-px grow bg-border" />
      </div>

      {groups.map((group) => {
        if (group.isLeaf) {
          const page = group.pages[0];

          return page === undefined ? null : (
            <NavLink
              key={group.id}
              to={page.path}
              className={({ isActive }) =>
                cn(
                  'group flex h-10 items-center gap-2.5 rounded-field px-2.5 text-ui transition-colors duration-150',
                  isActive
                    ? 'bg-surface-raised font-medium text-foreground'
                    : 'text-foreground-muted hover:bg-surface-raised/60 hover:text-foreground',
                )
              }
            >
              {({ isActive }) => (
                <>
                  <AppIcon
                    id={group.icon}
                    size={18}
                    className={cn(
                      'transition-colors',
                      isActive
                        ? 'text-primary'
                        : 'text-foreground-subtle group-hover:text-foreground-muted',
                    )}
                  />
                  <span className="grow">{text(group.label)}</span>
                </>
              )}
            </NavLink>
          );
        }

        const isActive = group.id === activeId;
        const isOpen = toggled?.id === group.id ? toggled.isOpen : isActive;

        return (
          <div key={group.id} className="flex flex-col">
            <button
              type="button"
              aria-expanded={isOpen}
              onClick={() => {
                onToggle(group.id, !isOpen);
              }}
              className={cn(
                'group flex h-10 w-full items-center gap-2.5 rounded-field px-2.5 text-left text-ui transition-colors duration-150',
                isActive
                  ? 'font-medium text-foreground'
                  : 'text-foreground-muted hover:bg-surface-raised/60 hover:text-foreground',
              )}
            >
              <AppIcon
                id={group.icon}
                size={18}
                className={cn(
                  'transition-colors',
                  isActive
                    ? 'text-primary'
                    : 'text-foreground-subtle group-hover:text-foreground-muted',
                )}
              />
              <span className="grow">{text(group.label)}</span>
              <AppIcon
                id="chevron-right"
                size={14}
                className={cn(
                  'text-foreground-subtle transition-transform duration-200',
                  isOpen && 'rotate-90',
                )}
              />
            </button>

            <div
              className={cn(
                'grid transition-[grid-template-rows,opacity] duration-200 ease-out',
                isOpen ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0',
              )}
              inert={!isOpen}
            >
              <div className="overflow-hidden">
                <div className="mt-0.5 mb-1.5 ml-4.5 flex flex-col gap-0.5 border-l border-border-strong pl-3">
                  {group.pages.map((page) => (
                    <NavLink
                      key={page.path}
                      to={page.path}
                      className={({ isActive: isHere }) =>
                        cn(
                          'flex h-8.5 items-center rounded-chip px-2.5 text-ui transition-colors duration-150',
                          isHere
                            ? 'bg-surface-raised font-medium text-foreground'
                            : 'text-foreground-muted hover:bg-surface-raised/60 hover:text-foreground',
                        )
                      }
                    >
                      {text(page.label)}
                    </NavLink>
                  ))}
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </>
  );
}

/**
 * Renders the settings frame.
 *
 * @returns The page.
 */
export function SettingsLayout() {
  const { t } = useTranslation();
  const can = useSession((state) => state.can);
  const { pathname } = useLocation();
  const tree = reachableTree(can);
  const activeId = settingsPageAt(pathname)?.group.id;

  // A group opened or shut by hand holds only on the page it was pressed on; moving to another
  // page goes back to "the current page's group open".
  const [toggled, setToggled] = useState<{ id: string; isOpen: boolean; at: string } | undefined>(
    undefined,
  );
  const override = toggled?.at === pathname ? toggled : undefined;

  /**
   * Opens or shuts a group by hand.
   *
   * @param id - Which group.
   * @param isOpen - Whether it should be open.
   */
  const onToggle = (id: string, isOpen: boolean): void => {
    setToggled({ id, isOpen, at: pathname });
  };

  return (
    <div className="relative min-w-0 grow overflow-y-auto px-8 pt-7 pb-12">
      <div className="flex flex-wrap items-start gap-x-12 gap-y-8">
        <aside className="flex min-w-0 flex-[0_0_232px] flex-col gap-4 max-sm:flex-auto">
          <h1 className="px-2.5 text-display-sm font-medium">{t('settings.title', 'Settings')}</h1>

          <SettingsSearch tree={tree} />

          <nav aria-label={t('settings.title', 'Settings')} className="flex flex-col gap-0.5">
            <Scope
              title={t('settings.groups.personal', 'Personal')}
              groups={tree.filter((group) => group.scope === 'personal')}
              activeId={activeId}
              toggled={override}
              onToggle={onToggle}
            />
            <Scope
              title={t('settings.groups.server', 'Server')}
              groups={tree.filter((group) => group.scope === 'server')}
              activeId={activeId}
              toggled={override}
              onToggle={onToggle}
            />
          </nav>
        </aside>

        <div className="flex min-w-0 flex-[1_1_420px] justify-center">
          <div className="flex w-full max-w-215 min-w-0 flex-col">
            <Outlet />
          </div>
        </div>
      </div>
    </div>
  );
}
