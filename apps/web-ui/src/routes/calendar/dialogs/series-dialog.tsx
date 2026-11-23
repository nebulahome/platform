/**
 * Which times of a repeating event a change is for (CAL-Event-Series, CAL-Rights): moved or
 * changed, this one alone or all of them; deleted, this one alone or this and every one after it,
 * the past ones staying. Two radio cards and the action, in a card dialog.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { AppIcon, Button, cn, Modal, RadioGroup } from '@nebulahome/ui';

/** What the dialog asks for. */
export type SeriesPurpose = 'move' | 'change' | 'delete';

/** What the dialog answers: this time alone, all of them, or this and every one after it. */
export type SeriesChoice = 'one' | 'all' | 'following';

/** What the dialog needs. */
export type SeriesDialogProps = {
  readonly purpose: SeriesPurpose;

  /** The event's title. */
  readonly title: string;

  /** How it repeats, "Every Thursday"; null while it is read. */
  readonly rule: string | null;

  /** What "Only this one" means here: the time, and what happens to the others. */
  readonly onlyNote: string;

  /** What the other choice means here. */
  readonly allNote: string;
  readonly isBusy: boolean;
  readonly onCancel: () => void;
  readonly onConfirm: (choice: SeriesChoice) => void;
};

/**
 * Renders the dialog. Mount it only while it asks.
 *
 * @param props - See {@link SeriesDialogProps}.
 * @returns The dialog.
 */
export function SeriesDialog(props: SeriesDialogProps) {
  const { t } = useTranslation();
  const { purpose, title, rule, isBusy } = props;
  const isDelete = purpose === 'delete';
  const [choice, setChoice] = useState<SeriesChoice>('one');
  const lowered = rule === null ? null : `${rule.slice(0, 1).toLowerCase()}${rule.slice(1)}`;

  return (
    <Modal
      isOpen
      size="small"
      layout="card"
      onClose={props.onCancel}
      lead={
        <span
          className={cn(
            'flex size-9.5 shrink-0 items-center justify-center rounded-tile',
            isDelete ? 'bg-danger/12 text-danger' : 'bg-primary/12 text-primary',
          )}
        >
          <AppIcon id={isDelete ? 'trash-2' : 'repeat'} size={18} />
        </span>
      }
      title={
        isDelete
          ? t('calendar.series.deleteTitle', 'Delete {{title}}?', { title })
          : lowered === null
            ? t('calendar.series.repeats', '{{title}} repeats', { title })
            : t('calendar.series.repeatsRule', '{{title}} repeats {{rule}}', {
                title,
                rule: lowered,
              })
      }
      description={
        isDelete
          ? lowered === null
            ? undefined
            : t('calendar.series.itRepeats', 'It repeats {{rule}}.', { rule: lowered })
          : purpose === 'move'
            ? t('calendar.series.whatMoves', 'What should move?')
            : t('calendar.series.whatChanges', 'What should change?')
      }
      footer={
        <>
          <Button variant="ghost" disabled={isBusy} onClick={props.onCancel}>
            {t('common.cancel', 'Cancel')}
          </Button>
          <Button
            variant={isDelete ? 'danger' : 'primary'}
            isBusy={isBusy}
            onClick={() => {
              props.onConfirm(choice);
            }}
          >
            {isDelete
              ? t('common.delete', 'Delete')
              : purpose === 'move'
                ? t('calendar.series.move', 'Move')
                : t('common.save', 'Save')}
          </Button>
        </>
      }
    >
      <RadioGroup<SeriesChoice>
        look="cards"
        isLabelHidden
        label={t('calendar.series.which', 'Which times')}
        value={choice}
        onChange={setChoice}
        options={[
          {
            value: 'one',
            label: t('calendar.series.onlyThis', 'Only this one'),
            note: props.onlyNote,
          },
          isDelete
            ? {
                value: 'following',
                label: t('calendar.series.thisAndNext', 'This and all the next ones'),
                note: props.allNote,
              }
            : { value: 'all', label: t('calendar.series.all', 'All of them'), note: props.allNote },
        ]}
      />
    </Modal>
  );
}
