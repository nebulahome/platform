/**
 * The command palette, open (docs: command palette; boards N-Command-Palette-*): a field, the list
 * it drives, and the keys bar, on a pane of dark glass 12vh from the top.
 *
 * A `Modal` in the bare layout: the browser's own dialog, its focus trap and its backdrop; what the
 * keys do, Escape included, is `use-palette-keys.ts`.
 *
 * The field keeps the focus throughout (combobox). Nothing waits for an animation: the field is
 * focused as the panel mounts, and a key pressed while something moves is handled at once.
 */
import { useDeferredValue, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { AppIcon, Modal } from '@nebulahome/ui';

import { useSession } from '@/auth/session-store';
import { queryWords } from '@/lib/search-text';
import { PaletteClipboardAsk } from '@/palette/palette-clipboard-ask';
import { PaletteKeys } from '@/palette/palette-keys';
import { layoutPalette } from '@/palette/palette-layout';
import { PaletteList } from '@/palette/palette-list';
import { readRecents } from '@/palette/palette-recents';
import { usePaletteStore } from '@/palette/palette-store';
import type { PaletteGroupId } from '@/palette/palette-types';
import { useAfter } from '@/palette/use-after';
import { useClipboardRow } from '@/palette/use-clipboard-row';
import { usePaletteItems } from '@/palette/use-palette-items';
import { usePaletteKeys } from '@/palette/use-palette-keys';
import { useCatalogueIcons } from '@/routes/library/device-icon';

/** How long a list may take before the search glyph becomes a spinner. */
const SLOW_LIST_MS = 150;

/**
 * Renders the open palette.
 *
 * @returns The dialog.
 */
export function PalettePanel() {
  const { t } = useTranslation();
  const close = usePaletteStore((state) => state.close);
  const can = useSession((state) => state.can);
  const userId = useSession((state) => state.user?.id ?? '');
  const { items, sources } = usePaletteItems();
  const listId = useId();

  const [query, setQuery] = useState('');
  const deferred = useDeferredValue(query);
  const [active, setActive] = useState(0);
  const [expanded, setExpanded] = useState<PaletteGroupId | null>(null);
  const [appliedKey, setAppliedKey] = useState<string | null>(null);
  const [isOpening, setOpening] = useState(true);
  const [recents] = useState(() => readRecents(userId));
  const snapRef = useRef(true);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const words = useMemo(() => queryWords(deferred), [deferred]);
  const clipboard = useClipboardRow(items);
  const layout = useMemo(
    () =>
      layoutPalette({
        items,
        words,
        recents,
        expanded,
        clipboard: clipboard.item,
        canSearchHub: can('integration:install'),
      }),
    [items, words, recents, expanded, clipboard.item, can],
  );
  const iconIds = useMemo(
    () => items.flatMap((item) => (item.icon.kind === 'catalogue' ? [item.icon.iconId] : [])),
    [items],
  );
  const icons = useCatalogueIcons(iconIds);
  const current = Math.min(active, Math.max(0, layout.options.length - 1));
  const option = layout.options[current];
  const isLoading = useAfter(
    sources.some((source) => source.isPending),
    SLOW_LIST_MS,
  );

  const keys = usePaletteKeys({
    layout,
    current,
    query,
    snapRef,
    buttonRef,
    setActive,
    setExpanded,
    setAppliedKey,
    onClipboardUsed: clipboard.consume,
  });

  const count = layout.options.length;

  return (
    <Modal
      isOpen
      onClose={close}
      title={t('palette.title', 'Command palette')}
      layout="bare"
      placement="top"
      className="palette-dialog"
    >
      <div className="palette-panel relative flex w-170 max-w-full flex-col overflow-hidden text-left">
        <div aria-hidden="true" className="palette-light" />

        <label className="relative flex h-17 shrink-0 items-center gap-3.5 border-b border-foreground/7 pr-5 pl-5.5 text-foreground/50">
          {isLoading ? (
            <AppIcon id="loader-circle" size={20} className="animate-orbit text-primary" />
          ) : (
            <AppIcon id="search" size={20} />
          )}
          <input
            type="text"
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={count === 0 ? undefined : `${listId}-${String(current)}`}
            aria-label={t('palette.placeholder', 'Search or run a command')}
            placeholder={t('palette.placeholder', 'Search or run a command')}
            // eslint-disable-next-line jsx-a11y/no-autofocus -- the palette is opened to type in
            autoFocus
            spellCheck={false}
            autoComplete="off"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setOpening(false);
              setActive(0);
              snapRef.current = true;
            }}
            onKeyDown={keys.onKeyDown}
            className="palette-field min-w-0 grow bg-transparent text-foreground caret-primary placeholder:text-foreground/45 focus-visible:outline-none"
          />
        </label>

        <PaletteList
          layout={layout}
          listId={listId}
          active={current}
          words={words}
          query={deferred}
          icons={icons}
          appliedKey={appliedKey}
          isOpening={isOpening}
          sources={sources}
          snapRef={snapRef}
          clipboardText={clipboard.id}
          buttonRef={buttonRef}
          onPoint={(index) => {
            snapRef.current = true;
            setActive(index);
          }}
          onChoose={keys.choose}
          onSecondary={keys.second}
        >
          {words.length === 0 && clipboard.isAsking ? (
            <PaletteClipboardAsk onAllow={clipboard.allow} onDismiss={clipboard.dismiss} />
          ) : null}
        </PaletteList>

        <PaletteKeys option={option} />

        <p aria-live="polite" className="sr-only">
          {deferred.trim() === ''
            ? ''
            : count === 0
              ? t('palette.nothing', 'Nothing matches “{{query}}”.', { query: deferred.trim() })
              : t('palette.count', {
                  count,
                  defaultValue_one: '{{count}} result',
                  defaultValue_other: '{{count}} results',
                })}
        </p>
      </div>
    </Modal>
  );
}
