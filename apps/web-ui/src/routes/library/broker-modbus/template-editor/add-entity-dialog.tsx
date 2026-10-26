/**
 * Add an entity: the seven kinds a template maps, a tile each - its icon in its tint, its name,
 * what it is and the capabilities it has. Picking one adds an entity of it, mapped the way most
 * devices are, for the owner to point at the right registers.
 */
import { useTranslation } from 'react-i18next';

import { MODBUS_DOMAINS, type ModbusDomain } from '@nebulahome/contracts';
import { AppIcon, cn, Modal } from '@nebulahome/ui';

import { DOMAIN_CAPABILITY_LINES, domainLooks } from './template-meta';

/** What the dialog needs. */
export type AddEntityDialogProps = {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly onPick: (domain: ModbusDomain) => void;
};

/**
 * Renders the dialog.
 *
 * @param props - See {@link AddEntityDialogProps}.
 * @returns The dialog.
 */
export function AddEntityDialog(props: AddEntityDialogProps) {
  const { isOpen, onClose, onPick } = props;
  const { t } = useTranslation();
  const looks = domainLooks();

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      size="picker"
      title={t('brokers.modbus.addEntity', 'Add an entity')}
      description={t(
        'brokers.modbus.addEntityLine',
        'What it is decides what it can do. Its registers come next.',
      )}
    >
      <ul className="grid gap-3 sm:grid-cols-2">
        {MODBUS_DOMAINS.map((domain) => {
          const look = looks[domain];

          return (
            <li key={domain}>
              <button
                type="button"
                className="flex h-full w-full items-start gap-3.5 rounded-card border border-border bg-surface px-4 py-3.5 text-left hover:border-border-strong hover:bg-surface-raised"
                onClick={() => {
                  onPick(domain);
                  onClose();
                }}
              >
                <span
                  className={cn(
                    'flex size-9 shrink-0 items-center justify-center rounded-field',
                    look.tint,
                  )}
                >
                  <AppIcon id={look.icon} size={17} />
                </span>
                <span className="flex min-w-0 flex-col gap-1">
                  <span className="text-ui font-medium text-foreground">{look.label}</span>
                  <span className="text-ui-sm text-foreground-muted">{look.line}</span>
                  <span className="font-mono text-mono-caption text-foreground-subtle">
                    {DOMAIN_CAPABILITY_LINES[domain]}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </Modal>
  );
}
