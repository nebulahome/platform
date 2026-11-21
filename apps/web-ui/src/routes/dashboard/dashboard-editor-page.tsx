/**
 * Laying a dashboard out (`N-Dashboard-Edit`): the grid unlocked, cards moved, resized, added in
 * the empty spaces and removed, and the settings of the card chosen floating at the top right.
 *
 * Reached from Configuration › Dashboards by whoever manages the dashboards, never from the
 * Dashboards page itself, which only shows. Editing works on a copy of the layout (see
 * `dashboard-draft.ts`): Done saves the whole layout in one request - and every person the
 * dashboard is assigned to sees it the next time their page reads - and Cancel throws the copy
 * away; both go back to the list. The copy survives leaving the page, and closing the tab asks
 * first. A card added from the catalogue that never got its entity is left out by Done.
 *
 * The header is a plain row - what is edited, who sees it, the width switch, Cancel and Done.
 * Desktop edits; Tablet and Phone show the same grid in a frame of that width, only to be looked
 * at. A window too narrow for four columns cannot move cards, and says so; settings still open.
 * Ctrl or Cmd with C, X and V copy, cut and paste the card chosen.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router';

import {
  dashboardLayoutSchema,
  type DashboardCard,
  type DashboardLayout,
  type DashboardView,
} from '@nebulahome/contracts';
import { toast } from '@nebulahome/ui';

import {
  DASHBOARD_QUERY_KEYS,
  fetchAssignees,
  fetchManagedDashboards,
  updateDashboard,
} from '@/dashboard/api';
import {
  addCard,
  addCardAt,
  findCard,
  removeCard,
  type CardPlace,
} from '@/dashboard/dashboard-layout';
import { listFormat } from '@/i18n/formatters';
import { toMessage } from '@/lib/error-message';
import { signalled } from '@/lib/signalled';
import { AddCardDialog } from '@/routes/dashboard/add-card-dialog';
import { CardSettings } from '@/routes/dashboard/card-settings';
import { cardTitle } from '@/routes/dashboard/card-view';
import { cardCopy, useDashboardClipboard } from '@/routes/dashboard/dashboard-clipboard';
import { isDraftDirty, useDashboardDraft } from '@/routes/dashboard/dashboard-draft';
import { DashboardGrid } from '@/routes/dashboard/dashboard-grid';
import { DASHBOARDS_CONFIGURATION_PATH, PageMessage } from '@/routes/dashboard/dashboard-page';
import { EditingHeader, type PreviewScreen } from '@/routes/dashboard/editing-header';
import { useDashboardData } from '@/routes/dashboard/use-dashboard-data';
import { PREVIEW_WIDTHS, WidthPreview, type PreviewFrame } from '@/routes/dashboard/width-preview';
import { DetailHeader } from '@/routes/library/detail-page';

/**
 * Renders the editor for the dashboard in the address.
 *
 * @returns The page.
 */
export function DashboardEditorPage() {
  const { t } = useTranslation();

  const { dashboardId = '' } = useParams();

  const dashboards = useQuery({
    queryKey: DASHBOARD_QUERY_KEYS.managed,
    queryFn: signalled(fetchManagedDashboards),
  });

  const dashboard = dashboards.data?.find((candidate) => candidate.id === dashboardId);

  if (dashboard === undefined) {
    return (
      <div className="flex min-h-0 grow flex-col">
        <DetailHeader
          crumbs={[
            {
              to: DASHBOARDS_CONFIGURATION_PATH,
              label: t('dashboard.dashboardEditor.dashboards', 'Dashboards'),
            },
          ]}
          title={t('dashboard.dashboardEditor.layout', 'Layout')}
        />
        <div className="p-6">
          <PageMessage>
            {dashboards.isPending
              ? t('dashboard.dashboardEditor.reading', 'Reading…')
              : dashboards.error === null
                ? t(
                    'dashboard.dashboardEditor.thereIsNoDashboard',
                    'There is no dashboard with that id.',
                  )
                : toMessage(dashboards.error)}
          </PageMessage>
        </div>
      </div>
    );
  }

  return <Editor key={dashboard.id} dashboard={dashboard} />;
}

/**
 * The editor itself, once the dashboard is read.
 *
 * @param props - The dashboard.
 * @param props.dashboard - As the server has it.
 * @returns The page.
 */
function Editor(props: { readonly dashboard: DashboardView }) {
  const { t } = useTranslation();

  const { dashboard } = props;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const draft = useDashboardDraft();
  const copied = useDashboardClipboard((state) => state.copied);
  const copy = useDashboardClipboard((state) => state.copy);
  const isEditing = draft.dashboardId === dashboard.id && draft.layout !== null;
  const layout: DashboardLayout = isEditing ? draft.layout : dashboard.layout;
  const data = useDashboardData(layout);
  const [addAt, setAddAt] = useState<CardPlace | null>(null);
  const [isNarrow, setNarrow] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [screen, setScreen] = useState<PreviewScreen>('desktop');
  const [previewWidth, setPreviewWidth] = useState<number>(PREVIEW_WIDTHS.tablet);
  const [side, setSide] = useState<'left' | 'right'>('right');
  const overlayRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const isDirty = isEditing && isDraftDirty(draft);
  const assignees = useQuery({
    queryKey: DASHBOARD_QUERY_KEYS.assignees,
    staleTime: 60_000,
    queryFn: signalled(fetchAssignees),
  });
  const viewers = dashboard.userIds.flatMap((id) => {
    const person = assignees.data?.find((each) => each.id === id);

    return person === undefined ? [] : [person.displayName];
  });
  const scenes = [...data.sceneById.values()];
  const { begin, selectedId } = draft;
  const hasBegun = useRef(false);
  const canMove = isEditing && screen === 'desktop' && !isNarrow;

  // A copy left from an earlier visit to this dashboard is picked up where it was left; any other
  // dashboard's is replaced. Once per visit: Done and Cancel end the copy on their way out, and
  // must not find a fresh one begun behind them.
  useEffect(() => {
    if (!hasBegun.current && !isEditing) {
      begin(dashboard.id, dashboard.layout);
    }

    hasBegun.current = true;
  }, [isEditing, begin, dashboard.id, dashboard.layout]);

  // Leaving the tab with an unsaved layout asks first; leaving the page keeps the copy.
  useEffect(() => {
    if (!isDirty) {
      return undefined;
    }

    /**
     * Asks the browser to confirm leaving.
     *
     * @param event - The unload.
     */
    const onLeave = (event: BeforeUnloadEvent): void => {
      event.preventDefault();
    };

    window.addEventListener('beforeunload', onLeave);

    return (): void => {
      window.removeEventListener('beforeunload', onLeave);
    };
  }, [isDirty]);

  // The settings float at the top right; when the card chosen lies under them they take the
  // mirrored place, top left, and go back with the next card that is not under them.
  useEffect(() => {
    if (selectedId === null) {
      return undefined;
    }

    let frame = 0;

    /** Works out the side from where the card and the panel are now. */
    const measure = (): void => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const overlay = overlayRef.current?.getBoundingClientRect();
        const panel = overlayRef.current?.querySelector('aside')?.getBoundingClientRect();
        const card = document
          .querySelector(`[data-card-id="${selectedId}"]`)
          ?.getBoundingClientRect();

        if (overlay === undefined || panel === undefined || card === undefined) {
          return;
        }

        const right = { left: overlay.right - panel.width, top: overlay.top };
        const isUnder =
          card.right > right.left &&
          card.left < overlay.right &&
          card.bottom > right.top &&
          card.top < right.top + panel.height;

        setSide(isUnder ? 'left' : 'right');
      });
    };

    measure();

    const scroller = scrollerRef.current;

    scroller?.addEventListener('scroll', measure, { passive: true });
    globalThis.addEventListener('resize', measure);

    return (): void => {
      cancelAnimationFrame(frame);
      scroller?.removeEventListener('scroll', measure);
      globalThis.removeEventListener('resize', measure);
    };
  }, [selectedId, layout, screen]);

  /** Goes back to the list of dashboards. */
  const leave = (): void => {
    void navigate(DASHBOARDS_CONFIGURATION_PATH);
  };

  const save = useMutation({
    /**
     * Saves the whole layout.
     *
     * @param next - The layout.
     * @returns The dashboard as it now stands.
     */
    mutationFn: async (next: DashboardLayout): Promise<DashboardView> =>
      updateDashboard(dashboard.id, { layout: next }),

    /** Reads the lists again, stops editing and goes back to the list. */
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: DASHBOARD_QUERY_KEYS.managed }),
        queryClient.invalidateQueries({ queryKey: DASHBOARD_QUERY_KEYS.dashboards }),
      ]);
      draft.end();
      setProblem(null);
      toast.success({
        title: t('dashboard.dashboardEditor.saved', '{{name}} saved', { name: dashboard.name }),
      });
      leave();
    },

    /**
     * Says why the layout could not be saved, and keeps editing.
     *
     * @param error - What went wrong.
     */
    onError: (error: unknown) => {
      toast.error({
        title: t('dashboard.dashboardEditor.saveFailed', 'Couldn’t save {{name}}', {
          name: dashboard.name,
        }),
        message: toMessage(error),
      });
    },
  });

  /** Saves the layout, after leaving out the cards still without an entity and checking it. */
  const done = (): void => {
    const waiting = Object.keys(draft.pending);
    const complete =
      draft.layout === null
        ? null
        : waiting.reduce((next, cardId) => removeCard(next, cardId), draft.layout);

    if (complete === null || (!isDirty && waiting.length === 0)) {
      draft.end();
      leave();

      return;
    }

    if (waiting.length > 0) {
      toast.info({
        title: t('dashboard.dashboardEditor.leftOut', {
          count: waiting.length,
          defaultValue_one: 'One card had no entity yet and was left out',
          defaultValue_other: '{{count}} cards had no entity yet and were left out',
        }),
      });
    }

    const checked = dashboardLayoutSchema.safeParse(complete);

    if (!checked.success) {
      const first = checked.error.issues[0];

      setProblem(
        first?.path.includes('title') === true
          ? t('dashboard.dashboardEditor.everyGroupNeedsA', 'Every group needs a name.')
          : t(
              'dashboard.dashboardEditor.cannotBeSaved',
              'This layout cannot be saved: {{problem}}.',
              {
                problem:
                  first?.message ??
                  t('dashboard.dashboardEditor.itDoesNotRead', 'it does not read'),
              },
            ),
      );

      return;
    }

    save.mutate(complete);
  };

  /** Throws the changes away and goes back to the list. */
  const cancel = (): void => {
    setProblem(null);
    draft.end();
    leave();
  };

  /**
   * Puts a new card on the draft at a place, or in the first free one, and opens its settings.
   *
   * @param card - The card.
   * @param place - The space chosen, or null for the first free place on the page.
   * @returns Whether it went on.
   */
  const putOn = (card: DashboardCard, place: CardPlace | null): boolean => {
    if (draft.layout === null) {
      return false;
    }

    const into =
      place === null
        ? addCard(draft.layout, card, null, data.sizesOf)
        : addCardAt(draft.layout, card, place, data.sizesOf);
    // A card that does not fit into a group - a camera into a narrow one - goes onto the page.
    const next = into === draft.layout ? addCard(draft.layout, card, null, data.sizesOf) : into;

    if (next === draft.layout) {
      return false;
    }

    draft.change(next);
    draft.select(card.id);

    return true;
  };

  /**
   * Pastes the copied card: into a space, or in the first free place on the page.
   *
   * @param place - The space, or null.
   */
  const paste = (place: CardPlace | null): void => {
    if (copied === null) {
      return;
    }

    if (copied.card.type === 'container' && place !== null && place.parentId !== null) {
      toast.info({
        title: t('dashboard.dashboardEditor.groupIntoGroup', 'A group cannot go into a group'),
      });

      return;
    }

    putOn(cardCopy(copied.card), place);
  };

  /**
   * Takes a card off the draft.
   *
   * @param cardId - The card.
   */
  const remove = (cardId: string): void => {
    if (draft.layout !== null) {
      draft.change(removeCard(draft.layout, cardId));
    }

    draft.setPending(cardId, null);

    if (draft.selectedId === cardId) {
      draft.select(null);
    }
  };

  /**
   * Keeps a card in the editor's clipboard.
   *
   * @param card - The card.
   */
  const copyCard = (card: DashboardCard): void => {
    copy(card, cardTitle(card, data));
  };

  // On the card chosen: Ctrl or Cmd and C copies it, X copies and removes it, V pastes the copy in
  // the first free place. A space with the focus takes its own V.
  useEffect(() => {
    if (!canMove) {
      return undefined;
    }

    /**
     * Copies, cuts or pastes.
     *
     * @param event - The key.
     */
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target;

      if (
        event.defaultPrevented ||
        !(event.ctrlKey || event.metaKey) ||
        (target instanceof HTMLElement &&
          (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)))
      ) {
        return;
      }

      const key = event.key.toLowerCase();
      const chosen =
        selectedId === null || draft.layout === null ? null : findCard(draft.layout, selectedId);

      if (
        (key === 'c' || key === 'x') &&
        chosen !== null &&
        draft.pending[chosen.card.id] === undefined
      ) {
        event.preventDefault();
        copyCard(chosen.card);

        if (key === 'x') {
          remove(chosen.card.id);
        }
      } else if (key === 'v' && copied !== null) {
        event.preventDefault();
        paste(null);
      }
    };

    globalThis.addEventListener('keydown', onKey);

    return (): void => {
      globalThis.removeEventListener('keydown', onKey);
    };
  });

  const hint =
    viewers.length === 0
      ? t(
          'dashboard.dashboardEditor.nobodySeesItYet',
          'Nobody sees it yet: assign it under Dashboard setup',
        )
      : viewers.length <= 3
        ? t('dashboard.dashboardEditor.viewersSeeTheChange', {
            count: viewers.length,
            names: listFormat({ type: 'conjunction' }).format(viewers),
            defaultValue_one: '{{names}} sees the change',
            defaultValue_other: '{{names}} see the change',
          })
        : t('dashboard.editingHeader.everyoneSees', 'Everyone who uses it sees the change');

  const addGroup = addAt?.parentId == null ? undefined : findCard(layout, addAt.parentId)?.card;

  /**
   * The grid, on the page or in a device's preview frame.
   *
   * @param frame - The preview's frame; none on the page.
   * @returns The grid.
   */
  const gridIn = (frame?: PreviewFrame): ReactNode => (
    <DashboardGrid
      {...(frame === undefined ? {} : { frame })}
      layout={layout}
      data={data}
      onNarrowChange={setNarrow}
      editor={
        isEditing
          ? {
              selectedId,
              onSelect: draft.select,
              onChange: draft.change,
              onRemove: remove,
              canMove,
              clipboardName: copied?.name ?? null,
              pending: draft.pending,
              onAddAt: setAddAt,
              onPasteAt: paste,
            }
          : null
      }
    />
  );

  return (
    <div className="relative flex min-h-0 min-w-0 grow flex-col">
      <div className="shrink-0 px-8 pt-6">
        <EditingHeader
          name={dashboard.name}
          hint={
            screen === 'desktop'
              ? hint
              : t(
                  'dashboard.editingHeader.previewOnly',
                  'Preview only · cards cannot be moved here, their settings still open',
                )
          }
          screen={screen}
          onScreen={(next) => {
            setScreen(next);

            if (next !== 'desktop') {
              setPreviewWidth(PREVIEW_WIDTHS[next]);
            }
          }}
          onCancel={cancel}
          onDone={done}
          isSaving={save.isPending}
        />
        {problem === null ? null : (
          <p role="alert" className="mt-2 animate-rise text-ui-sm text-danger">
            {problem}
          </p>
        )}
      </div>

      <div ref={scrollerRef} className="min-h-0 grow overflow-y-auto px-8 pt-5 pb-7">
        {isNarrow && screen === 'desktop' ? (
          <p className="mb-4 rounded-tile border border-border bg-surface px-4 py-3 text-ui-sm text-foreground-muted">
            {t(
              'dashboard.dashboardEditor.widenToMove',
              'Widen the window to move and resize cards: the layout takes four columns. Their settings still open.',
            )}
          </p>
        ) : null}
        {screen === 'desktop' ? (
          gridIn()
        ) : (
          <WidthPreview device={screen} width={previewWidth} onWidth={setPreviewWidth}>
            {gridIn}
          </WidthPreview>
        )}
      </div>

      {isEditing && selectedId !== null ? (
        <div
          ref={overlayRef}
          className="pointer-events-none absolute inset-x-8 top-[72px] bottom-6 z-30"
        >
          <CardSettings
            layout={layout}
            cardId={selectedId}
            pendingKind={draft.pending[selectedId] ?? null}
            data={data}
            scenes={scenes}
            side={side}
            isCopied={copied?.card.id === selectedId}
            onChange={draft.change}
            onSettled={(cardId) => {
              draft.setPending(cardId, null);
            }}
            onRemove={remove}
            onCopy={copyCard}
            onClose={() => {
              draft.select(null);
            }}
          />
        </div>
      ) : null}

      <AddCardDialog
        isOpen={addAt !== null && isEditing}
        onClose={() => {
          setAddAt(null);
        }}
        targetName={addGroup?.type === 'container' ? addGroup.title : dashboard.name}
        isInGroup={addGroup !== undefined}
        data={data}
        scenes={scenes}
        onAdd={({ card, pendingKind }) => {
          // A group takes the full width, from the row of the space chosen.
          const place = card.type === 'container' && addAt !== null ? { ...addAt, x: 0 } : addAt;

          if (putOn(card, place) && pendingKind !== null) {
            draft.setPending(card.id, pendingKind);
          }

          setAddAt(null);
        }}
      />
    </div>
  );
}
