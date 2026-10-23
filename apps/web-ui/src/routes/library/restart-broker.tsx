/**
 * Restarting a broker from its page: a **Restart** button beside the page's other actions, a small
 * dialog that asks first and says what it does to the house, and the page read again after.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { AppIcon, Button, Modal, toast } from '@nebulahome/ui';

import { toMessage } from '@/lib/error-message';

/** What the button needs. */
export type RestartBrokerProps = {
  /** The broker's name: `Matter`, `MQTT`. */
  readonly name: string;

  /** What restarting it does to the house, said before it is done. */
  readonly line: string;

  /** Restarts it. */
  readonly restart: () => Promise<unknown>;
};

/**
 * Renders the button and the question it asks.
 *
 * @param props - See {@link RestartBrokerProps}.
 * @returns The button, and its dialog while open.
 */
export function RestartBroker(props: RestartBrokerProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { name, line, restart } = props;
  const [isAsking, setIsAsking] = useState(false);

  const restarting = useMutation({
    mutationFn: restart,

    /** Says it is back. */
    onSuccess: () => {
      setIsAsking(false);
      toast.success({ title: t('brokers.restarted', '{{name}} restarted', { name }) });
    },

    /**
     * Says why it did not.
     *
     * @param error - What the server answered.
     */
    onError: (error) => {
      toast.error({
        title: t('brokers.restartFailed', 'Couldn’t restart {{name}}', { name }),
        message: toMessage(error),
      });
    },

    /** Reads the broker again. */
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['brokers'] });
    },
  });

  /** Closes the question, unless the restart is under way. */
  const close = (): void => {
    if (!restarting.isPending) {
      setIsAsking(false);
    }
  };

  return (
    <>
      <Button
        variant="ghost"
        onClick={() => {
          setIsAsking(true);
        }}
      >
        <AppIcon id="rotate-ccw" size={15} />
        {t('brokers.restart', 'Restart')}
      </Button>
      <Modal
        isOpen={isAsking}
        onClose={close}
        size="small"
        title={t('brokers.restartTitle', 'Restart {{name}}?', { name })}
        footer={
          <>
            <Button variant="ghost" disabled={restarting.isPending} onClick={close}>
              {t('common.cancel', 'Cancel')}
            </Button>
            <Button
              isBusy={restarting.isPending}
              onClick={() => {
                restarting.mutate();
              }}
            >
              {t('brokers.restart', 'Restart')}
            </Button>
          </>
        }
      >
        <p className="text-ui-sm leading-normal text-foreground-muted">{line}</p>
      </Modal>
    </>
  );
}
