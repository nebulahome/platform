/**
 * The dialog a sixth page opens (docs: app windows, decision 3 and 4.7): five pages are open,
 * hidden ones included, so one has to close first. They are listed from the one used longest ago,
 * which is chosen to begin with; closing it ends only its page, the integration and its container keep running.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button, Modal, RadioGroup } from '@nebulahome/ui';

import { MAX_WINDOWS, useAppWindows } from '@/app-windows/app-windows-store';
import { relativeTime } from '@/lib/format-time';

/**
 * Renders the dialog, while a page waits for room.
 *
 * @returns The dialog.
 */
export function LimitDialog() {
  const { t } = useTranslation();
  const pending = useAppWindows((state) => state.pending);
  const windows = useAppWindows((state) => state.windows);
  const byUse = windows.toSorted((a, b) => a.usedAt - b.usedAt);
  const oldest = byUse[0]?.name ?? '';
  const [choice, setChoice] = useState(oldest);
  const [askedFor, setAskedFor] = useState(pending);

  // A new page waiting: the oldest window is the one chosen again.
  if (pending !== askedFor) {
    setAskedFor(pending);
    setChoice(oldest);
  }

  const { replace, cancel } = useAppWindows.getState();

  return (
    <Modal
      isOpen={pending !== null}
      onClose={cancel}
      size="brief"
      title={t('appWindows.limit.title', '{{limit}} pages are open', { limit: MAX_WINDOWS })}
      description={t('appWindows.limit.description', 'Close one to open {{name}}.', {
        name: pending?.title ?? '',
      })}
      footer={
        <>
          <Button variant="ghost" onClick={cancel}>
            {t('appWindows.limit.cancel', 'Cancel')}
          </Button>
          <Button
            disabled={choice === ''}
            onClick={() => {
              replace(choice);
            }}
          >
            {t('appWindows.limit.confirm', 'Close and open')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <RadioGroup
          label={t('appWindows.limit.label', 'Page to close')}
          look="cards"
          value={choice}
          onChange={setChoice}
          options={byUse.map((each) => ({
            value: each.name,
            label: each.title,
            note: each.isHidden
              ? t('appWindows.limit.hidden', 'Integration · hidden · used {{when}}', {
                  when: relativeTime(new Date(each.usedAt)),
                })
              : t('appWindows.limit.open', 'Integration · open · used {{when}}', {
                  when: relativeTime(new Date(each.usedAt)),
                }),
          }))}
        />
        <p className="text-ui-sm text-foreground-subtle">
          {t(
            'appWindows.limit.note',
            'Only the page closes: the integration and its container keep running. Anything not saved in that page is lost.',
          )}
        </p>
      </div>
    </Modal>
  );
}
