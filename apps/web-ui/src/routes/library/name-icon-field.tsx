/**
 * A name with its icon beside it: one field, one label, the two things a row is recognised by.
 *
 * The icon used to be a row of its own, a full-width button saying "Change…", under a name that
 * had nothing to do with it. On a device and on an entity the two are one thing - what the row
 * looks like - so they are one control: a single box with the icon at its left edge and the name
 * filling the rest, the way a search box carries its glyph. Pressing the icon opens the
 * catalogue, the same picker as before; the field owns it so that neither dialog has to.
 *
 * The box is what the field face belongs to. The wrapper takes the border, the sunk fill and
 * the focus ring - lit by `focus-within`, so focus on the icon and focus in the name both light
 * the one control - and the button and the input inside it draw no edge of their own.
 *
 * The button draws the icon and nothing else, so it says what it holds to a reader through its
 * text rather than its label: the label is what pressing it does, the text is the icon's name.
 */
import { useQuery } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';

import type { IconView } from '@nebulahome/contracts';
import { CatalogueIcon, cn, FieldShell } from '@nebulahome/ui';

import { fetchIcons, LIBRARY_QUERY_KEYS } from '@/library/api';
import { IconPickerModal } from '@/routes/library/icon-picker-modal';

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
    <>
      <FieldShell label={label} hint={hint} error={error}>
        {(ids) => (
          <div
            className={cn(
              'flex h-control w-full items-stretch overflow-hidden rounded-field border bg-surface-raised text-foreground transition-colors',
              'focus-within:ring-3 focus-within:ring-primary/25',
              ids.isInvalid
                ? 'border-danger focus-within:border-danger focus-within:ring-danger/25'
                : 'border-border focus-within:border-primary',
            )}
          >
            <button
              type="button"
              aria-label="Change icon"
              aria-describedby={ids.describedBy}
              onClick={() => {
                setPicking(true);
              }}
              className={cn(
                'press flex aspect-square shrink-0 items-center justify-center border-r border-border text-foreground transition-colors',
                'hover:bg-surface-raised focus-visible:bg-surface-raised focus-visible:outline-none',
              )}
            >
              {shown === undefined ? (
                <span className="size-5.5 rounded-tile bg-surface-raised" aria-hidden="true" />
              ) : (
                <CatalogueIcon node={shown.node} frame={shown.frame} size={22} />
              )}
              <span className="sr-only">{shown?.name ?? icon ?? 'None'}</span>
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
              className="min-w-0 grow bg-transparent px-3.5 text-ui text-foreground placeholder:text-foreground-disabled focus-visible:outline-none"
            />
          </div>
        )}
      </FieldShell>

      <IconPickerModal
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
    </>
  );
}
