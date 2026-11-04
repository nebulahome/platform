/**
 * A field that holds one icon of the catalogue: its label, and the 44px icon button that opens
 * the catalogue picker under it. What a package's `field.icon` and `<IconField>` draw.
 */
import type { ReactNode } from 'react';

import { FieldShell } from '@nebulahome/ui';

import { IconPickButton } from '@/routes/library/name-icon-field';

/** What the field needs. */
export type IconFieldProps = {
  readonly label: string;
  readonly isLabelHidden?: boolean;

  /** The icon's id, or null for none yet. */
  readonly value: string | null;

  /** Called with the id of the icon picked. */
  readonly onChange: (id: string) => void;

  readonly hint?: ReactNode;
  readonly error?: string | undefined;
};

/**
 * Renders an icon field.
 *
 * @param props - See {@link IconFieldProps}.
 * @returns The field, and the picker it opens.
 */
export function IconField(props: IconFieldProps) {
  const { label, isLabelHidden = false, value, onChange, hint, error } = props;

  return (
    <FieldShell label={label} isLabelHidden={isLabelHidden} hint={hint} error={error}>
      {(ids) => (
        <IconPickButton
          id={ids.id}
          label={label}
          icon={value === '' ? null : value}
          describedBy={ids.describedBy}
          onPick={(icon) => {
            onChange(icon.id);
          }}
        />
      )}
    </FieldShell>
  );
}
