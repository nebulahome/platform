/**
 * The second step of removing something: the question, and the two ways out of it.
 *
 * A dialog's footer swaps to this when its Remove button is pressed, so the confirmation takes
 * the place of Save and Cancel rather than stacking a second dialog on the first. The question
 * says what goes with the thing - "its 6 entities", "off 3 devices" - because "Are you sure?"
 * asks for a nerve rather than a decision.
 */
import { useTranslation } from 'react-i18next';

import { Button } from '@nebulahome/ui';

/** What the confirmation needs. */
export type ConfirmRemovalProps = {
  /** What is asked, naming what goes with it. */
  readonly question: string;

  /** What the confirming button says; `Remove` unless said otherwise. */
  readonly label?: string;

  /** Called to go through with it. */
  readonly onConfirm: () => void;

  /** Called to think better of it. */
  readonly onCancel: () => void;

  /** Whether the removal is under way. */
  readonly isBusy?: boolean;
};

/**
 * Renders the question and its two buttons.
 *
 * @param props - See {@link ConfirmRemovalProps}.
 * @returns The footer's contents while confirming.
 */
export function ConfirmRemoval(props: ConfirmRemovalProps) {
  const { t } = useTranslation();

  const { question, label = 'Remove', onConfirm, onCancel, isBusy = false } = props;

  return (
    <>
      <p role="alert" className="mr-auto text-ui text-foreground">
        {question}
      </p>
      <Button variant="ghost" disabled={isBusy} onClick={onCancel}>
        {t('common.cancel', 'Cancel')}
      </Button>
      <Button variant="danger" isBusy={isBusy} onClick={onConfirm}>
        {label}
      </Button>
    </>
  );
}
