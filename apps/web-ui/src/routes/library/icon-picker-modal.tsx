/**
 * Choosing an icon from the catalogue.
 *
 * A search over the whole catalogue - the platform's own ids first, then everything lucide
 * ships, then whatever the owner added - drawn as a grid of the icons themselves, because a
 * name like `radar` says less about a sensor than the drawing does. Picking one hands its id
 * back and shuts the dialog; what the id draws is the catalogue's business, so a device keeps
 * the id and not the drawing.
 *
 * Opened over another dialog, as it is from the device form. Escape is kept from reaching the
 * document, where the form's dialog listens for it too, so one press closes the picker alone.
 */
import { useQuery } from '@tanstack/react-query';
import { useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';

import type { IconView } from '@nebulahome/contracts';
import { Button, CatalogueIcon, cn, Modal, TextField } from '@nebulahome/ui';

import { useDebounced } from '@/lib/use-debounced';
import { fetchIcons, LIBRARY_QUERY_KEYS } from '@/library/api';

/** How many icons one search shows at most. */
const PAGE = 120;

/** What the picker needs. */
export type IconPickerModalProps = {
  readonly isOpen: boolean;
  readonly onClose: () => void;

  /** The id chosen so far, drawn as pressed. */
  readonly current: string | null;

  /** Called with the id picked. */
  readonly onPick: (icon: IconView) => void;
};

/**
 * Renders the picker.
 *
 * @param props - See {@link IconPickerModalProps}.
 * @returns The dialog.
 */
export function IconPickerModal(props: IconPickerModalProps) {
  const { t } = useTranslation();

  const { isOpen, onClose, current, onPick } = props;
  const [search, setSearch] = useState('');
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

  /**
   * Keeps Escape to this dialog.
   *
   * @param event - The key press.
   */
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onClose();
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t('library.iconPickerModal.chooseAnIcon', 'Choose an icon')}
      description={t(
        'library.iconPickerModal.platformSOwnIcons',
        "The platform's own icons first, then everything else in the catalogue.",
      )}
      size="large"
      footer={
        <Button variant="ghost" onClick={onClose}>
          {t('common.cancel', 'Cancel')}
        </Button>
      }
    >
      {/* The wrapper is not itself interactive: it only hears the Escape that bubbles up from
          the search box or a grid button, before the document does. */}
      {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions */}
      <div className="flex flex-col gap-4" onKeyDown={onKeyDown}>
        <TextField
          label={t('library.iconPickerModal.searchIcons', 'Search icons')}
          isLabelHidden
          size="compact"
          type="search"
          placeholder={t('library.iconPickerModal.searchIcons2', 'Search icons…')}
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
          }}
        />

        {icons.isPending ? (
          <p className="text-ui text-foreground-muted">
            {t('library.iconPickerModal.looking', 'Looking…')}
          </p>
        ) : icons.error !== null ? (
          <p role="alert" className="text-ui text-danger">
            {t('library.iconPickerModal.catalogueCouldNotBe', 'The catalogue could not be read.')}
          </p>
        ) : icons.data.length === 0 ? (
          <p className="text-ui text-foreground-muted">
            {t('library.iconPickerModal.nothingMatches', 'Nothing matches.')}
          </p>
        ) : (
          <ul
            className="grid max-h-96 grid-cols-4 gap-1 overflow-y-auto pr-1 sm:grid-cols-6"
            aria-label={t('library.iconPickerModal.icons', 'Icons')}
          >
            {icons.data.map((icon) => (
              <li key={icon.id}>
                <button
                  type="button"
                  aria-label={icon.name}
                  aria-pressed={icon.id === current}
                  title={icon.id}
                  className={cn(
                    'flex w-full flex-col items-center gap-1.5 rounded-field border px-1 py-2.5 transition-colors',
                    icon.id === current
                      ? 'border-primary/40 bg-primary/13 text-primary'
                      : 'border-transparent text-foreground-muted hover:bg-surface-raised hover:text-foreground',
                  )}
                  onClick={() => {
                    onPick(icon);
                  }}
                >
                  <CatalogueIcon node={icon.node} frame={icon.frame} size={22} />
                  <span className="max-w-full truncate text-label">{icon.name}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}
