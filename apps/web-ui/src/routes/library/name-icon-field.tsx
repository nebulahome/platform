/**
 * A name with its icon beside it: the two things a row is recognised by, under one label.
 *
 * Two controls of one height side by side - a 44px icon button and the name - so the icon reads
 * as part of the name without hiding inside its box. Pressing the icon opens the catalogue
 * picker as a popover under it; the field owns the picker so that no dialog has to. Every place
 * that names something with an icon (a device, an entity, an area, a scene, a tag, a dashboard, a
 * role) uses this one field.
 *
 * The button draws the icon and nothing else, so it says what it holds to a reader through its
 * text rather than its label: the label is what pressing it does, the text is the icon's name.
 */
import { useQuery } from '@tanstack/react-query';
import { useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import type { IconView } from '@nebulahome/contracts';
import { CatalogueIcon, cn, FieldShell } from '@nebulahome/ui';

import { fetchIcons, LIBRARY_QUERY_KEYS } from '@/library/api';
import { IconPicker } from '@/routes/library/icon-picker';

/** What the field needs. */
export type NameIconFieldProps = {
  /** What the field is for; `Name` unless said otherwise. */
  readonly label?: string;

  /** The name as it stands. */
  readonly value: string;

  /** Called with the name as typed. */
  readonly onChange: (value: string) => void;

  /** The icon id, or null for none. */
  readonly icon: string | null;

  /** Called with the icon picked from the catalogue. */
  readonly onIconChange: (icon: IconView) => void;

  /** A line under the control, for what the label cannot say. */
  readonly hint?: ReactNode;

  /** What is wrong with the name, when something is. */
  readonly error?: string | undefined;

  /** Whether the name may be blank. */
  readonly required?: boolean;
};

/**
 * Renders the field.
 *
 * @param props - See {@link NameIconFieldProps}.
 * @returns The field, and the picker it opens.
 */
export function NameIconField(props: NameIconFieldProps) {
  const { t } = useTranslation();

  const {
    label = 'Name',
    value,
    onChange,
    icon,
    onIconChange,
    hint,
    error,
    required = false,
  } = props;
  const [picked, setPicked] = useState<IconView | undefined>(undefined);
  const [isPicking, setPicking] = useState(false);
  const button = useRef<HTMLButtonElement>(null);

  const read = useQuery({
    queryKey: [...LIBRARY_QUERY_KEYS.icons, 'one', icon ?? ''],
    /**
     * Reads the icon the row has, to draw it on the button.
     *
     * @param context - What TanStack Query provides, including the cancellation signal.
     * @param context.signal - Cancels the request when the icon changes.
     * @returns The icon, or undefined when the catalogue does not have it.
     */
    queryFn: async ({ signal }: { signal: AbortSignal }) =>
      (await fetchIcons({ ids: [icon ?? ''] }, signal))[0],
    enabled: icon !== null && picked?.id !== icon,
  });
  const shown = icon === null ? undefined : picked?.id === icon ? picked : read.data;

  return (
    <FieldShell label={label} hint={hint} error={error}>
      {(ids) => (
        <div className="flex gap-2">
          <button
            ref={button}
            type="button"
            aria-label={t('library.nameIconField.changeIcon', 'Change icon')}
            aria-haspopup="dialog"
            aria-expanded={isPicking}
            aria-describedby={ids.describedBy}
            onClick={() => {
              setPicking(!isPicking);
            }}
            className={cn(
              'press-scale flex size-11 shrink-0 items-center justify-center rounded-tile border transition-colors duration-150',
              'focus-visible:shadow-focus focus-visible:outline-none',
              isPicking
                ? 'border-primary bg-primary/14 text-primary'
                : 'border-border-strong bg-surface-raised text-foreground hover:border-foreground-subtle/50 hover:bg-surface-high',
            )}
          >
            {shown === undefined ? (
              <span className="size-4.5 rounded-check bg-surface-high" aria-hidden="true" />
            ) : (
              <CatalogueIcon node={shown.node} frame={shown.frame} size={18} />
            )}
            <span className="sr-only">
              {shown?.name ?? icon ?? t('library.nameIconField.none', 'None')}
            </span>
          </button>

          <input
            id={ids.id}
            type="text"
            value={value}
            required={required}
            aria-invalid={ids.isInvalid}
            aria-describedby={ids.describedBy}
            onChange={(event) => {
              onChange(event.target.value);
            }}
            className={cn(
              'h-control-lg min-w-0 grow rounded-tile border bg-veil px-3.5 text-title text-foreground transition duration-150',
              'placeholder:text-foreground-subtle focus-visible:shadow-focus focus-visible:outline-none',
              ids.isInvalid
                ? 'border-danger focus-visible:border-danger'
                : 'border-border-strong focus-visible:border-primary',
            )}
          />

          <IconPicker
            anchor={button}
            isOpen={isPicking}
            current={icon}
            onClose={() => {
              setPicking(false);
            }}
            onPick={(view) => {
              setPicked(view);
              setPicking(false);
              onIconChange(view);
            }}
          />
        </div>
      )}
    </FieldShell>
  );
}
