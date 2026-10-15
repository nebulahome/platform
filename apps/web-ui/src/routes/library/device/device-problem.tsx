/**
 * What is wrong with a device, in a card of its own.
 *
 * The hub's last word on a device can be long - a firmware's answer, a database's refusal - and a
 * line under the device's name is no place for it. So the lists say only that there is something
 * to read, and the device's page reads it here: what the state means in a sentence, then the
 * message as it was written, a few lines of it until asked for all of it. A device with no
 * entities yet shows this in their place, since it is the reason there are none.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { DeviceView } from '@nebulahome/contracts';
import { AppIcon, Button, cn, Panel } from '@nebulahome/ui';

import { translate } from '@/i18n/messages';

/** How long a message may be before it is folded to its first lines. */
const FOLDED_LENGTH = 240;

/**
 * Says what a device's state means, for the sentence above the message.
 *
 * @param state - The device's state.
 * @returns The title of the card and its first sentence.
 */
function wordsFor(state: DeviceView['state']): { readonly title: string; readonly lead: string } {
  switch (state) {
    case 'identifying':
      return {
        title: translate('device.deviceProblem.waitingForTheDevice', 'Waiting for the device'),
        lead: translate(
          'device.deviceProblem.hubKeepsListeningAnd',
          'The hub keeps listening, and has not heard from the device yet. The last attempt said:',
        ),
      };
    case 'failed':
      return {
        title: translate('device.deviceProblem.problem', 'Problem'),
        lead: translate(
          'device.deviceProblem.deviceIsNotWorking',
          'The device is not working. The hub last said:',
        ),
      };
    default:
      return {
        title: translate('device.deviceProblem.problem', 'Problem'),
        lead: translate(
          'device.deviceProblem.somethingWentWrongThe',
          'Something went wrong the last time the hub spoke to the device:',
        ),
      };
  }
}

/**
 * Renders the card, or nothing for a device with nothing wrong.
 *
 * @param props - The device.
 * @param props.device - The device.
 * @returns The card, or null.
 */
export function DeviceProblem(props: { readonly device: DeviceView }) {
  const { t } = useTranslation();

  const { device } = props;
  const [isOpen, setOpen] = useState(false);

  if (device.lastError === null) {
    return null;
  }

  const { title, lead } = wordsFor(device.state);
  const isLong = device.lastError.length > FOLDED_LENGTH;
  const isWaiting = device.state === 'identifying';

  return (
    <Panel title={title}>
      <div className="flex gap-3 px-4 py-3.5">
        <AppIcon
          id={isWaiting ? 'clock' : 'triangle-alert'}
          size={16}
          className={cn('mt-0.5 shrink-0', isWaiting ? 'text-foreground-subtle' : 'text-danger')}
        />
        <div className="flex min-w-0 flex-col gap-2">
          <p className="text-ui text-foreground">{lead}</p>
          <p
            className={cn(
              'font-mono text-caption break-words whitespace-pre-wrap text-foreground-muted',
              isLong && !isOpen && 'line-clamp-3',
            )}
          >
            {device.lastError}
          </p>
          {isLong ? (
            <Button
              variant="ghost"
              size="compact"
              className="self-start"
              aria-expanded={isOpen}
              onClick={() => {
                setOpen(!isOpen);
              }}
            >
              {isOpen
                ? t('device.deviceProblem.showLess', 'Show less')
                : t('device.deviceProblem.showAll', 'Show all')}
            </Button>
          ) : null}
        </div>
      </div>
    </Panel>
  );
}
