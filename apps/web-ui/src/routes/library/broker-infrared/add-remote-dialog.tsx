/**
 * Adding a remote: three steps across the dialog, then its page.
 *
 * **Blaster** - which blaster sends its codes: online ones to pick, an offline one greyed.
 * **What it is** - its name, its room and its kind, six tiles in a row. **First buttons** - learn
 * them from the remote, import codes written down elsewhere, or later: each lands on the remote's
 * page, with the learn or import dialog already open when chosen.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import {
  INFRARED_REMOTE_KINDS,
  type AreaView,
  type InfraredBlaster,
  type InfraredRemoteKind,
} from '@nebulahome/contracts';
import {
  AppIcon,
  Button,
  cn,
  Modal,
  Note,
  SelectField,
  StatusDot,
  TextField,
  WizardSteps,
  type UiIconId,
} from '@nebulahome/ui';

import { toMessage } from '@/lib/error-message';
import { saveInfraredRemote } from '@/library/infrared-api';
import { ChoiceCard, DeviceTag } from '@/routes/library/broker-parts';
import { BrokerMark } from '@/routes/library/brokers-page';

import { INFRARED_TEXT, KIND_ICONS, kindName } from './infrared-parts';
import { remotePath } from './infrared-tabs';

/** What the remote's page opens with, once it is made. */
export type FirstButtons = 'learn' | 'import' | 'later';

/** What the dialog needs. */
export type AddRemoteDialogProps = {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly blasters: readonly InfraredBlaster[];
  readonly rooms: readonly AreaView[];
  readonly roomOf: (areaId: string | null) => string | null;
};

/**
 * Renders the dialog.
 *
 * @param props - See {@link AddRemoteDialogProps}.
 * @returns The dialog.
 */
export function AddRemoteDialog(props: AddRemoteDialogProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { isOpen, onClose, blasters, rooms, roomOf } = props;
  const [step, setStep] = useState(0);
  const [blasterId, setBlasterId] = useState(
    () => blasters.find((blaster) => blaster.isOnline)?.deviceId ?? null,
  );
  const [name, setName] = useState('');
  const [areaId, setAreaId] = useState('');
  const [kind, setKind] = useState<InfraredRemoteKind>('tv');
  const [first, setFirst] = useState<FirstButtons>('learn');
  const blaster = blasters.find((each) => each.deviceId === blasterId);

  const save = useMutation({
    /**
     * Makes the remote.
     *
     * @returns It.
     */
    mutationFn: async () =>
      saveInfraredRemote({
        name: name.trim(),
        kind,
        blasterId,
        areaId: areaId === '' ? null : areaId,
      }),

    /**
     * Opens its page, with the dialog for its first buttons.
     *
     * @param saved - The remote.
     */
    onSuccess: (saved) => {
      void queryClient.invalidateQueries({ queryKey: ['brokers'] });
      onClose();
      void navigate(first === 'later' ? remotePath(saved) : `${remotePath(saved)}?open=${first}`);
    },
  });

  const steps = [
    t('brokers.infrared.add.blaster', 'Blaster'),
    t('brokers.infrared.add.whatItIs', 'What it is'),
    t('brokers.infrared.add.firstButtons', 'First buttons'),
  ];
  const firsts: readonly {
    readonly id: FirstButtons;
    readonly icon: UiIconId;
    readonly title: string;
    readonly line: string;
  }[] = [
    {
      id: 'learn',
      icon: 'radio',
      title: t('brokers.infrared.add.learn', 'Learn from the remote'),
      line: t(
        'brokers.infrared.add.learnLine',
        'Point the remote at {{blaster}} and press each button once. Takes about a minute for a TV.',
        { blaster: blaster?.name ?? '' },
      ),
    },
    {
      id: 'import',
      icon: 'upload',
      title: t('brokers.infrared.add.import', 'Import codes'),
      line: t(
        'brokers.infrared.add.importLine',
        'Paste Broadlink, Pronto or raw codes, or drop a Flipper Zero .ir file.',
      ),
    },
    {
      id: 'later',
      icon: 'clock',
      title: t('brokers.infrared.add.later', 'Later'),
      line: t(
        'brokers.infrared.add.laterLine',
        'Make the remote now, and add its buttons from its page.',
      ),
    },
  ];

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      size="large"
      layout="card"
      lead={<BrokerMark broker="infrared" size={44} isLit />}
      title={t('brokers.infrared.add.title', 'Add a remote')}
      description={
        step === 0
          ? t('brokers.infrared.add.line', 'Which blaster sends its codes')
          : step === 1
            ? t('brokers.infrared.add.through', 'Through {{blaster}}', {
                blaster: blaster?.name ?? '',
              })
            : [name.trim(), kindName(kind), roomOf(areaId === '' ? null : areaId)]
                .filter(Boolean)
                .join(' · ')
      }
      closesOnBackdrop={step === 0}
      footer={
        <>
          <span />
          <span className="flex items-center gap-2">
            <Button
              variant="bare"
              onClick={() => {
                if (step === 0) {
                  onClose();
                } else {
                  setStep(step - 1);
                }
              }}
            >
              {step === 0 ? t('common.cancel', 'Cancel') : t('common.back', 'Back')}
            </Button>
            {step < 2 ? (
              <Button
                disabled={step === 0 ? blaster === undefined : name.trim() === ''}
                onClick={() => {
                  setStep(step + 1);
                }}
              >
                {t('common.next', 'Next')}
              </Button>
            ) : (
              <Button
                isBusy={save.isPending}
                onClick={() => {
                  save.mutate();
                }}
              >
                {t('brokers.infrared.add.submit', 'Add remote')}
              </Button>
            )}
          </span>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <WizardSteps steps={steps} current={step} layout="stacked" />

        {step === 0 ? (
          <div role="radiogroup" className="flex flex-col gap-2.5">
            {blasters.map((each) => (
              <ChoiceCard
                key={each.deviceId}
                isChosen={each.deviceId === blasterId}
                isDisabled={!each.isOnline}
                onSelect={() => {
                  setBlasterId(each.deviceId);
                }}
                trailing={
                  each.isOnline ? (
                    <span className="flex items-center gap-1.5 text-success">
                      <StatusDot
                        isBare
                        tone="success"
                        title={t('brokers.infrared.online', 'Online')}
                      />
                      {t('brokers.infrared.online', 'Online')}
                    </span>
                  ) : (
                    t('brokers.infrared.offline', 'Offline')
                  )
                }
              >
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-ui font-medium text-foreground">{each.name}</span>
                    <DeviceTag name={each.vendorName} />
                  </span>
                  <span className="text-ui-sm text-foreground-muted">
                    {[
                      roomOf(each.areaId),
                      each.signals.includes('rf')
                        ? t('brokers.infrared.irAndRf', 'IR and RF 433')
                        : t('brokers.infrared.irOnly', 'IR'),
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </span>
              </ChoiceCard>
            ))}
          </div>
        ) : null}

        {step === 1 ? (
          <div className="flex flex-col gap-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <TextField
                label={t('brokers.infrared.add.name', 'Name')}
                value={name}
                placeholder={t('brokers.infrared.add.namePlaceholder', 'Living room TV')}
                onChange={(event) => {
                  setName(event.target.value);
                }}
              />
              <SelectField
                label={t('brokers.infrared.add.room', 'Room')}
                value={areaId}
                onChange={setAreaId}
                options={[
                  { value: '', label: t('brokers.infrared.noRoom', 'No room') },
                  ...rooms.map((room) => ({ value: room.id, label: room.name })),
                ]}
              />
            </div>
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-2 text-ui-sm text-foreground-muted">
                {t('brokers.infrared.add.kind', 'Kind')}
              </legend>
              <div role="radiogroup" className="grid grid-cols-3 gap-2 sm:grid-cols-6">
                {INFRARED_REMOTE_KINDS.map((each) => (
                  <button
                    key={each}
                    type="button"
                    role="radio"
                    aria-checked={each === kind}
                    onClick={() => {
                      setKind(each);
                    }}
                    className={cn(
                      'flex h-19 flex-col items-center justify-center gap-2 rounded-inner border text-caption focus-visible:ring-3 focus-visible:ring-primary/25 focus-visible:outline-none',
                      each === kind
                        ? 'border-primary/70 bg-primary/8 font-medium text-foreground'
                        : 'border-border text-foreground-muted hover:border-border-strong',
                    )}
                  >
                    <AppIcon
                      id={KIND_ICONS[each]}
                      size={18}
                      className={each === kind ? INFRARED_TEXT : undefined}
                    />
                    {kindName(each)}
                  </button>
                ))}
              </div>
            </fieldset>
          </div>
        ) : null}

        {step === 2 ? (
          <div role="radiogroup" className="flex flex-col gap-2.5">
            {firsts.map((each) => (
              <ChoiceCard
                key={each.id}
                isChosen={each.id === first}
                onSelect={() => {
                  setFirst(each.id);
                }}
                className="py-4"
              >
                <span
                  className={cn(
                    'flex size-11 shrink-0 items-center justify-center rounded-field bg-[#f7895c]/12',
                    INFRARED_TEXT,
                  )}
                >
                  <AppIcon id={each.icon} size={19} />
                </span>
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-ui font-medium text-foreground">{each.title}</span>
                  <span className="text-ui-sm leading-normal text-foreground-muted">
                    {each.line}
                  </span>
                </span>
              </ChoiceCard>
            ))}
          </div>
        ) : null}

        {save.error === null ? null : <Note tone="danger">{toMessage(save.error)}</Note>}
      </div>
    </Modal>
  );
}
