/**
 * The button beside a button entity's name: one press from the list, without opening anything -
 * the switch's counterpart for an entity that holds no state.
 *
 * A refusal is said in its tooltip, as the switch says one.
 */
import { useTranslation } from 'react-i18next';

import { Button } from '@nebulahome/ui';

import { useEntityCommand } from '@/routes/library/entity/use-entity-command';

/** What the button needs. */
export type QuickPressButtonProps = {
  /** The entity, by its address. */
  readonly entityId: string;

  /** What it is called, for the button's label. */
  readonly name: string;
};

/**
 * Renders the button.
 *
 * @param props - See {@link QuickPressButtonProps}.
 * @returns The button.
 */
export function QuickPressButton(props: QuickPressButtonProps) {
  const { t } = useTranslation();
  const { entityId, name } = props;
  const commander = useEntityCommand(entityId);

  return (
    <span className="relative z-10 inline-flex items-center" title={commander.problem ?? undefined}>
      <Button
        size="compact"
        variant="ghost"
        aria-label={t('library.quickPressButton.pressName', 'Press {{name}}', { name })}
        isBusy={commander.busy.has('button')}
        onClick={() => {
          commander.send('button', { command: 'press' });
        }}
      >
        {t('entity.controls.buttonControl.press', 'Press')}
      </Button>
    </span>
  );
}
