/**
 * "Add a card": what kind of card, then which one.
 *
 * An entity is chosen in the picker every other field uses, by floor, room and device, and several
 * can be chosen at once - each becomes its own card, at the size its kind starts at. A scene is
 * chosen from the scenes this person may see. A clock and a group need nothing more. A package's
 * card is chosen from the cards the installed packages add, each under its package's name; a
 * package that is not running still offers them, and the card says so until it runs.
 *
 * Cards go into the group the person is working in - the one selected, or the one holding the
 * card selected - and onto the page otherwise; the dialog says which.
 *
 * The picker opens above this dialog rather than in its place: shutting a dialog tells it it was
 * dismissed, and this one would take that for the person giving up on adding a card.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { DashboardCard, SceneView } from '@nebulahome/contracts';
import { AppIcon, Button, CatalogueIcon, Modal, type UiIconId } from '@nebulahome/ui';

import {
  clockCard,
  containerCard,
  energyCard,
  entityCardFor,
  packageCardFor,
  sceneCardFor,
} from '@/dashboard/new-cards';
import { defineMessage, type Message, text } from '@/i18n/messages';
import { useInstalledPackages } from '@/packages/use-packages';
import { useCatalogueIcons } from '@/routes/library/device-icon';
import { EntityPicker } from '@/routes/library/entity-picker/entity-picker';

/** What the dialog needs. */
export type AddCardDialogProps = {
  readonly isOpen: boolean;
  readonly onClose: () => void;

  /** The group new cards go into, by name; null for the page. */
  readonly groupName: string | null;

  /** The scenes this person may see. */
  readonly scenes: readonly SceneView[];

  /** Takes the new cards. */
  readonly onAdd: (cards: readonly DashboardCard[]) => void;
};

/** One kind of card on offer. */
type Choice = {
  readonly key: 'entity' | 'scene' | 'clock' | 'energy' | 'package' | 'group';
  readonly label: Message;
  readonly summary: Message;
  readonly icon: UiIconId;
};

/** The kinds of card, in the order they are offered. */
const CHOICES: readonly Choice[] = [
  {
    key: 'entity',
    label: defineMessage('dashboard.addCardDialog.entity', 'Entity'),
    summary: defineMessage(
      'dashboard.addCardDialog.lightASensorA',
      'A light, a sensor, a lock: drawn from what it can do.',
    ),
    icon: 'lightbulb',
  },
  {
    key: 'scene',
    label: defineMessage('dashboard.addCardDialog.scene', 'Scene'),
    summary: defineMessage(
      'dashboard.addCardDialog.buttonThatAppliesA',
      'A button that applies a scene.',
    ),
    icon: 'play',
  },
  {
    key: 'clock',
    label: defineMessage('dashboard.addCardDialog.clock', 'Clock'),
    summary: defineMessage('dashboard.addCardDialog.timeAndTheDate', 'The time and the date.'),
    icon: 'clock',
  },
  {
    key: 'energy',
    label: defineMessage('dashboard.addCardDialog.energy', 'Energy'),
    summary: defineMessage(
      'dashboard.addCardDialog.houseItsPanelsBattery',
      'The house, its panels, battery and grid, and the power between them.',
    ),
    icon: 'zap',
  },
  {
    key: 'package',
    label: defineMessage('dashboard.addCardDialog.fromAPackage', 'From a package'),
    summary: defineMessage(
      'dashboard.addCardDialog.cardAnInstalledPackage',
      'A card an installed package draws: a broker, a recorder, a player.',
    ),
    icon: 'package',
  },
  {
    key: 'group',
    label: defineMessage('dashboard.addCardDialog.group', 'Group'),
    summary: defineMessage(
      'dashboard.addCardDialog.titledBoxYouDrag',
      'A titled box you drag other cards into.',
    ),
    icon: 'layout-grid',
  },
];

/**
 * Renders the dialog.
 *
 * @param props - See {@link AddCardDialogProps}.
 * @returns The dialog.
 */
export function AddCardDialog(props: AddCardDialogProps) {
  const { t } = useTranslation();

  const { isOpen, onClose, groupName, scenes, onAdd } = props;
  const [step, setStep] = useState<'kind' | 'scene' | 'package'>('kind');
  const [isPicking, setPicking] = useState(false);
  const { packages } = useInstalledPackages();
  const offering = packages.flatMap((found) =>
    (found.ui?.cards ?? []).map((declared) => ({ found, declared })),
  );
  const icons = useCatalogueIcons(offering.map(({ declared }) => declared.icon));

  /** Closes the dialog and starts it afresh next time. */
  const close = (): void => {
    setStep('kind');
    setPicking(false);
    onClose();
  };

  /**
   * Adds cards and closes.
   *
   * @param cards - The new cards.
   */
  const add = (cards: readonly DashboardCard[]): void => {
    onAdd(cards);
    close();
  };

  return (
    <>
      <Modal
        isOpen={isOpen}
        onClose={close}
        title={
          step === 'scene'
            ? t('dashboard.addCardDialog.whichScene', 'Which scene?')
            : step === 'package'
              ? t('dashboard.addCardDialog.whichCard', 'Which card?')
              : t('dashboard.addCardDialog.addACard', 'Add a card')
        }
        description={
          groupName === null
            ? t('dashboard.addCardDialog.itGoesOnThe', 'It goes on the page.')
            : t('dashboard.addCardDialog.itGoesIntoGroupname', 'It goes into {{groupName}}.', {
                groupName,
              })
        }
        footer={
          step === 'kind' ? (
            <Button variant="ghost" onClick={close}>
              {t('common.cancel', 'Cancel')}
            </Button>
          ) : (
            <Button
              variant="ghost"
              className="mr-auto"
              onClick={() => {
                setStep('kind');
              }}
            >
              {t('dashboard.addCardDialog.back', 'Back')}
            </Button>
          )
        }
      >
        {step === 'kind' ? (
          <ul className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            {CHOICES.filter(
              (choice) =>
                (choice.key !== 'group' || groupName === null) &&
                (choice.key !== 'package' || offering.length > 0),
            ).map((choice) => (
              <li key={choice.key} className="list-none">
                <button
                  type="button"
                  className="press flex h-full w-full items-start gap-3 rounded-panel border border-border bg-surface p-3.5 text-left hover:border-border-strong"
                  onClick={() => {
                    if (choice.key === 'entity') {
                      setPicking(true);
                    } else if (choice.key === 'scene') {
                      setStep('scene');
                    } else if (choice.key === 'clock') {
                      add([clockCard()]);
                    } else if (choice.key === 'energy') {
                      add([energyCard()]);
                    } else if (choice.key === 'package') {
                      setStep('package');
                    } else {
                      add([containerCard(t('dashboard.addCardDialog.newGroup', 'New group'))]);
                    }
                  }}
                >
                  <span
                    aria-hidden="true"
                    className="flex size-9 shrink-0 items-center justify-center rounded-tile border border-primary/25 bg-primary/12 text-primary"
                  >
                    <AppIcon id={choice.icon} size={17} />
                  </span>
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-title font-medium">{text(choice.label)}</span>
                    <span className="text-caption text-foreground-subtle">
                      {text(choice.summary)}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : step === 'package' ? (
          <ul className="flex max-h-96 flex-col gap-1.5 overflow-y-auto">
            {offering.map(({ found, declared }) => {
              const icon = icons.get(declared.icon);

              return (
                <li key={`${found.id}:${declared.id}`} className="list-none">
                  <button
                    type="button"
                    className="press flex w-full items-center gap-3 rounded-field border border-border bg-surface px-3.5 py-2.5 text-left hover:border-border-strong"
                    onClick={() => {
                      add([packageCardFor(found.id, declared)]);
                    }}
                  >
                    <span
                      aria-hidden="true"
                      className="flex size-8 shrink-0 items-center justify-center rounded-tile border border-border bg-surface-raised text-foreground-muted"
                    >
                      {icon === undefined ? (
                        <AppIcon id="package" size={15} />
                      ) : (
                        <CatalogueIcon node={icon.node} frame={icon.frame} size={15} />
                      )}
                    </span>
                    <span className="flex min-w-0 grow flex-col gap-0.5">
                      <span className="truncate text-ui font-medium">{declared.name}</span>
                      <span className="truncate text-caption text-foreground-subtle">
                        {declared.description ?? found.name}
                      </span>
                    </span>
                    <span className="shrink-0 text-caption text-foreground-subtle">
                      {found.name}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : scenes.length === 0 ? (
          <p className="text-ui text-foreground-muted">
            {t(
              'dashboard.addCardDialog.thereAreNoScenes',
              'There are no scenes to add. Make one on the Scenes page first.',
            )}
          </p>
        ) : (
          <ul className="flex max-h-96 flex-col gap-1.5 overflow-y-auto">
            {scenes.map((scene) => (
              <li key={scene.id} className="list-none">
                <button
                  type="button"
                  className="press flex w-full items-center justify-between gap-3 rounded-field border border-border bg-surface px-3.5 py-2.5 text-left hover:border-border-strong"
                  onClick={() => {
                    add([sceneCardFor(scene.id)]);
                  }}
                >
                  <span className="truncate text-ui font-medium">{scene.name}</span>
                  <span className="shrink-0 text-caption text-foreground-subtle tabular">
                    {t('dashboard.cards.sceneCard.things', {
                      count: scene.members.length,
                      defaultValue_one: '{{count}} thing',
                      defaultValue_other: '{{count}} things',
                    })}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Modal>

      <EntityPicker
        isOpen={isOpen && isPicking}
        isMultiple
        title={t('dashboard.addCardDialog.whichOnes', 'Which ones?')}
        onClose={() => {
          setPicking(false);
        }}
        onChoose={(entities) => {
          add(entities.map((entity) => entityCardFor(entity)));
        }}
      />
    </>
  );
}
