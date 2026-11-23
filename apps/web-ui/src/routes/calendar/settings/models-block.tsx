/**
 * A calendar's event models in its open row (CAL-Set-Calendars, CAL-Set-Models): each with its
 * token, its name and its colour, a pencil that opens it beside the row, and Add a model.
 */
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { CalendarModel, CalendarView } from '@nebulahome/contracts';
import { AppIcon, Button, cn, IconButton, TAG_FILL_CLASSES } from '@nebulahome/ui';

import { ModelToken } from '@/routes/calendar/model-token';
import { ModelPopover } from '@/routes/calendar/settings/model-popover';
import { useCatalogueIcons } from '@/routes/library/device-icon';

/** What the block needs. */
export type ModelsBlockProps = {
  readonly calendar: CalendarView;
};

/**
 * Renders the block.
 *
 * @param props - See {@link ModelsBlockProps}.
 * @returns The block.
 */
export function ModelsBlock(props: ModelsBlockProps) {
  const { t } = useTranslation();
  const { calendar } = props;
  const icons = useCatalogueIcons(calendar.models.map((model) => model.icon));
  const add = useRef<HTMLButtonElement>(null);
  const pencils = useRef(new Map<string, HTMLButtonElement>());
  const [editing, setEditing] = useState<CalendarModel | 'new' | null>(null);
  const anchor = useRef<HTMLElement | null>(null);

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-start justify-between gap-4">
        <span className="flex flex-col gap-0.75">
          <span className="text-ui font-medium">{t('calendar.models.title', 'Event models')}</span>
          <span className="text-caption text-foreground-subtle">
            {t(
              'calendar.models.line',
              'Name, icon and colour ready to use: in a new event, one tap. In automations, a trigger can pick them.',
            )}
          </span>
        </span>
        {calendar.canEdit ? (
          <Button
            ref={add}
            variant="bare"
            size="compact"
            aria-expanded={editing === 'new'}
            onClick={() => {
              anchor.current = add.current;
              setEditing(editing === 'new' ? null : 'new');
            }}
          >
            <AppIcon id="plus" size={14} />
            {t('calendar.models.add', 'Add a model')}
          </Button>
        ) : null}
      </div>

      <div className="rounded-inner border border-border bg-well">
        {calendar.models.length === 0 ? (
          <p className="flex items-center gap-3 p-4 text-ui-sm text-foreground-subtle">
            <AppIcon id="tag" size={16} className="shrink-0" />
            {t(
              'calendar.models.none',
              'No models yet. Useful when the same kind of event comes back: lessons, visits, matches.',
            )}
          </p>
        ) : (
          calendar.models.map((model) => (
            <div
              key={model.id}
              className="flex items-center gap-3 border-t border-border py-2 pr-2 pl-2.5 first:border-t-0"
            >
              <ModelToken icon={icons.get(model.icon)} color={model.color} size={30} />
              <span className="min-w-0 grow truncate text-ui">{model.name}</span>
              <span
                aria-hidden="true"
                className={cn('mx-1.5 size-3 shrink-0 rounded-full', TAG_FILL_CLASSES[model.color])}
              />
              {calendar.canEdit ? (
                <IconButton
                  ref={(element) => {
                    if (element === null) {
                      pencils.current.delete(model.id);
                    } else {
                      pencils.current.set(model.id, element);
                    }
                  }}
                  label={t('calendar.models.edit', 'Edit the model')}
                  aria-expanded={editing !== null && editing !== 'new' && editing.id === model.id}
                  onClick={() => {
                    anchor.current = pencils.current.get(model.id) ?? null;
                    setEditing(model);
                  }}
                >
                  <AppIcon id="pencil" size={15} />
                </IconButton>
              ) : null}
            </div>
          ))
        )}
      </div>

      {editing === null ? null : (
        <ModelPopover
          key={editing === 'new' ? 'new' : editing.id}
          anchor={anchor}
          calendarId={calendar.id}
          {...(editing === 'new' ? {} : { model: editing })}
          onClose={() => {
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}
