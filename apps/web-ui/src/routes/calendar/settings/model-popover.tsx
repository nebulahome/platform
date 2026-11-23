/**
 * A calendar's event model made or changed in a popover beside the row (CAL-Set-Models): its icon
 * and name - the platform's 44px icon button and its catalogue popover - and its colour.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';

import type { CalendarModel, TagColor } from '@nebulahome/contracts';
import { Button, ColorSwatches, IconButton, AppIcon, Popover, toast } from '@nebulahome/ui';

import { toMessage } from '@/lib/error-message';
import { CALENDAR_QUERY_KEYS } from '@/routes/calendar/api';
import {
  createCalendarModel,
  deleteCalendarModel,
  updateCalendarModel,
} from '@/routes/calendar/settings/settings-api';
import { ConfirmRemoval } from '@/routes/library/confirm-removal';
import { NameIconField } from '@/routes/library/name-icon-field';

/** What the popover needs. */
export type ModelPopoverProps = {
  /** The control it hangs from. */
  readonly anchor: RefObject<HTMLElement | null>;

  /** The calendar the model is in. */
  readonly calendarId: string;

  /** The model to change; a new one when absent. */
  readonly model?: CalendarModel;
  readonly onClose: () => void;
};

/** The glyph a new model starts with, until one is picked. */
const NEW_ICON = 'tag';

/**
 * Renders the popover.
 *
 * @param props - See {@link ModelPopoverProps}.
 * @returns The popover.
 */
export function ModelPopover(props: ModelPopoverProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { anchor, calendarId, model, onClose } = props;
  const [name, setName] = useState(model?.name ?? '');
  const [icon, setIcon] = useState(model?.icon ?? NEW_ICON);
  const [color, setColor] = useState<TagColor>(model?.color ?? 'indigo');
  const [isConfirming, setConfirming] = useState(false);

  /**
   * Says why a change was not saved.
   *
   * @param error - What the server answered.
   */
  const failed = (error: unknown): void => {
    toast.error({ title: t('calendar.models.notSaved', 'Not saved'), message: toMessage(error) });
  };

  /** Reads the calendars again and closes. */
  const done = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: CALENDAR_QUERY_KEYS.calendars });
    onClose();
  };

  const save = useMutation({
    /**
     * Makes the model, or saves it.
     *
     * @returns The model.
     */
    mutationFn: async () =>
      model === undefined
        ? createCalendarModel(calendarId, { name: name.trim(), icon, color })
        : updateCalendarModel(model.id, { name: name.trim(), icon, color }),
    onSuccess: done,
    onError: failed,
  });
  const remove = useMutation({
    /**
     * Deletes the model.
     *
     * @returns When it is gone.
     */
    mutationFn: async () => (model === undefined ? undefined : deleteCalendarModel(model.id)),
    onSuccess: done,
    onError: failed,
  });

  return (
    <Popover
      anchor={anchor}
      isOpen
      onClose={onClose}
      width={400}
      label={
        model === undefined
          ? t('calendar.models.newModel', 'New model')
          : t('calendar.models.editModel', 'Edit the model')
      }
    >
      <div className="flex items-center justify-between gap-2 pt-3.5 pr-2.5 pb-1 pl-4.5">
        <span className="text-title font-medium">
          {model === undefined
            ? t('calendar.models.newModel', 'New model')
            : t('calendar.models.editModel', 'Edit the model')}
        </span>
        <IconButton label={t('common.close', 'Close')} onClick={onClose}>
          <AppIcon id="x" size={16} />
        </IconButton>
      </div>
      <div className="flex flex-col gap-3.5 px-4.5 pt-2.5 pb-4">
        <NameIconField
          value={name}
          required
          onChange={setName}
          icon={icon}
          onIconChange={(view) => {
            setIcon(view.id);
          }}
        />
        <ColorSwatches
          label={t('calendar.models.colour', 'Colour')}
          value={color}
          onChange={setColor}
        />
      </div>
      <div className="flex items-center justify-end gap-2 border-t border-border px-4.5 py-3">
        {isConfirming ? (
          <ConfirmRemoval
            question={t(
              'calendar.models.deleteQuestion',
              'Delete {{name}}? Its events keep their titles.',
              { name: model?.name ?? '' },
            )}
            label={t('calendar.models.delete', 'Delete')}
            isBusy={remove.isPending}
            onCancel={() => {
              setConfirming(false);
            }}
            onConfirm={() => {
              remove.mutate();
            }}
          />
        ) : (
          <>
            {model === undefined ? null : (
              <Button
                variant="bare"
                size="compact"
                className="mr-auto text-danger"
                onClick={() => {
                  setConfirming(true);
                }}
              >
                {t('calendar.models.delete', 'Delete')}
              </Button>
            )}
            <Button variant="ghost" size="compact" onClick={onClose}>
              {t('common.cancel', 'Cancel')}
            </Button>
            <Button
              size="compact"
              disabled={name.trim() === ''}
              isBusy={save.isPending}
              onClick={() => {
                save.mutate();
              }}
            >
              {model === undefined
                ? t('calendar.models.addModel', 'Add model')
                : t('common.save', 'Save')}
            </Button>
          </>
        )}
      </div>
    </Popover>
  );
}
