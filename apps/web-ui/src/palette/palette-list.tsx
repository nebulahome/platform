/**
 * The command palette's list (boards N-Command-Palette-Results, -Empty, -Loading, -Group-Error):
 * the groups with their names, the one highlight that slides from row to row, and a height that
 * follows the rows until the panel is full, past which it scrolls and fades at its foot.
 *
 * The highlight is one element under the rows, so it can slide (`use-palette-highlight.ts`); it
 * jumps instead when a key is held, past either end, under the pointer and after a new query.
 */
import type { ReactNode, Ref, RefObject } from 'react';
import { useTranslation } from 'react-i18next';

import type { IconView } from '@nebulahome/contracts';

import { defineMessage, text } from '@/i18n/messages';
import type { PaletteLayout } from '@/palette/palette-layout';
import { PaletteLineOption } from '@/palette/palette-line-option';
import { PaletteRow } from '@/palette/palette-row';
import { PaletteWaitingGroup } from '@/palette/palette-waiting-group';
import type { PaletteSectionId } from '@/palette/rank';
import { ROWS_EXPANDED } from '@/palette/rank';
import { usePaletteHighlight } from '@/palette/use-palette-highlight';
import type { PaletteSourceState } from '@/palette/use-palette-items';

/** What each group is called. */
const LABELS: Readonly<Record<PaletteSectionId, ReturnType<typeof defineMessage>>> = {
  clipboard: defineMessage('palette.groups.clipboard', 'Clipboard'),
  recent: defineMessage('palette.groups.recent', 'Recent'),
  entities: defineMessage('palette.groups.entities', 'Entities'),
  scenes: defineMessage('palette.groups.scenes', 'Scenes'),
  automations: defineMessage('palette.groups.automations', 'Automations'),
  devices: defineMessage('palette.groups.devices', 'Devices'),
  pages: defineMessage('palette.groups.pages', 'Pages'),
  settings: defineMessage('palette.groups.settings', 'Settings'),
  integrations: defineMessage('palette.groups.integrations', 'Integrations'),
  packages: defineMessage('palette.groups.packages', 'Packages'),
  tags: defineMessage('palette.groups.tags', 'Tags'),
  actions: defineMessage('palette.groups.actions', 'Actions'),
};

/** How many rows rise one after another as the palette opens. */
const ARRIVING = 8;

/** What the list needs. */
export type PaletteListProps = {
  readonly layout: PaletteLayout;
  readonly listId: string;
  readonly active: number;

  /** The query's words, folded. */
  readonly words: readonly string[];

  /** The query as typed, for the line that says nothing matched. */
  readonly query: string;
  readonly icons: ReadonlyMap<string, IconView>;

  /** The option of the scene just applied. */
  readonly appliedKey: string | null;

  /** Whether the palette is still opening: its rows rise one after another. */
  readonly isOpening: boolean;

  /** Lists still coming or failed, shown once something is typed. */
  readonly sources: readonly PaletteSourceState[];

  /** Set when the next move of the highlight should jump; read and cleared here. */
  readonly snapRef: RefObject<boolean>;

  /** The id the Clipboard group shows beside its name. */
  readonly clipboardText: string | null;
  readonly buttonRef: Ref<HTMLButtonElement>;

  /** Anything quieter at the foot of the list: the line that asks to read the clipboard. */
  readonly children?: ReactNode;
  readonly onPoint: (index: number) => void;
  readonly onChoose: (index: number) => void;
  readonly onSecondary: (index: number) => void;
};

/**
 * Renders the list.
 *
 * @param props - See {@link PaletteListProps}.
 * @returns The list.
 */
export function PaletteList(props: PaletteListProps) {
  const { t } = useTranslation();
  const { layout, listId, active, words, icons, isOpening, sources, snapRef } = props;
  /**
   * The id of an option, for the field's `aria-activedescendant`.
   *
   * @param index - Its place among the options.
   * @returns The id.
   */
  const optionIdOf = (index: number): string => `${listId}-${String(index)}`;
  const { scroller, content, highlight, measured, fade } = usePaletteHighlight(
    optionIdOf(active),
    snapRef,
  );

  let arrival = 0;
  const shown = new Set(layout.sections.map((section) => section.id));
  const waiting = words.length === 0 ? [] : sources.filter((source) => !shown.has(source.group));
  const isEmpty = words.length > 0 && layout.sections.length === 0 && waiting.length === 0;

  return (
    <div
      ref={scroller}
      onScroll={fade}
      onTransitionEnd={fade}
      className="palette-list relative min-h-0 scrollbar-none overflow-y-auto overscroll-contain"
    >
      <div
        ref={measured}
        id={listId}
        role="listbox"
        aria-label={t('palette.results', 'Results')}
        className="px-2 pt-0.5 pb-2"
      >
        <div ref={content} className="relative flex flex-col">
          <div ref={highlight} aria-hidden="true" className="palette-active" />

          {layout.sections.map((section) => {
            const headingId = `${listId}-${section.id}`;

            return (
              <div
                key={section.id}
                role="group"
                aria-labelledby={headingId}
                className="flex flex-col"
              >
                <div className="flex h-8.5 shrink-0 items-center justify-between gap-3 px-3 pt-2 font-mono text-label text-foreground/42">
                  <span id={headingId} className="uppercase">
                    {text(LABELS[section.id])}
                  </span>
                  {section.id === 'clipboard' && props.clipboardText !== null ? (
                    <span translate="no" className="truncate">
                      {props.clipboardText}
                    </span>
                  ) : null}
                </div>

                {layout.options.map((option, index) => {
                  if (option.kind === 'item' && option.section === section.id) {
                    const isFirst = isOpening && arrival < ARRIVING;

                    return (
                      <PaletteRow
                        key={option.key}
                        item={option.item}
                        optionId={optionIdOf(index)}
                        words={words}
                        icons={icons}
                        isActive={index === active}
                        isApplied={option.key === props.appliedKey}
                        hasKind={section.id === 'recent' || section.id === 'clipboard'}
                        arrival={isFirst ? arrival++ : null}
                        buttonRef={props.buttonRef}
                        onPoint={() => {
                          props.onPoint(index);
                        }}
                        onChoose={() => {
                          props.onChoose(index);
                        }}
                        onSecondary={() => {
                          props.onSecondary(index);
                        }}
                      />
                    );
                  }

                  return option.kind === 'more' && option.group === section.id ? (
                    <PaletteLineOption
                      key={option.key}
                      optionId={optionIdOf(index)}
                      icon="chevron-down"
                      isActive={index === active}
                      onPoint={() => {
                        props.onPoint(index);
                      }}
                      onChoose={() => {
                        props.onChoose(index);
                      }}
                    >
                      {t('palette.showAll', 'Show all {{count}}', { count: option.total })}
                    </PaletteLineOption>
                  ) : null;
                })}

                {section.isExpanded && section.total > ROWS_EXPANDED ? (
                  <p className="flex h-10 items-center px-3 text-ui-sm text-foreground-subtle">
                    {t(
                      'palette.refine',
                      'Showing {{shown}} of {{count}}. Type more to narrow it down.',
                      {
                        shown: ROWS_EXPANDED,
                        count: section.total,
                      },
                    )}
                  </p>
                ) : null}
              </div>
            );
          })}

          {waiting.map((source) => (
            <PaletteWaitingGroup
              key={source.group}
              label={text(LABELS[source.group])}
              source={source}
            />
          ))}

          {isEmpty ? (
            <p className="flex h-10 items-center px-3 pt-2 text-ui-sm text-foreground-subtle">
              {t('palette.nothing', 'Nothing matches “{{query}}”.', { query: props.query.trim() })}
            </p>
          ) : null}

          {layout.options.map((option, index) =>
            option.kind === 'hub' ? (
              <PaletteLineOption
                key={option.key}
                optionId={optionIdOf(index)}
                icon="library"
                isActive={index === active}
                onPoint={() => {
                  props.onPoint(index);
                }}
                onChoose={() => {
                  props.onChoose(index);
                }}
              >
                {t('palette.searchHub', 'Search the Hub for “{{query}}”', {
                  query: props.query.trim(),
                })}
              </PaletteLineOption>
            ) : null,
          )}

          {props.children}
        </div>
      </div>
    </div>
  );
}
