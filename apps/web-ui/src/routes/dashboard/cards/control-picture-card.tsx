/**
 * A picture that changes - a robot's map, a printer's plate - filling the card to its edges, its
 * name and how fresh it is over the foot of it, and Open for the picture at full size.
 *
 * The picture follows the entity's state: each new revision is fetched once, and the one on
 * screen stays until the next has arrived. As a sample it shows the sample source's picture.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { AppIcon, cn, Modal } from '@nebulahome/ui';

import { relativeTime } from '@/lib/format-time';
import { useEntityImage } from '@/library/use-entity-image';
import { Caption } from '@/routes/dashboard/cards/card-kit';
import { CardFrame } from '@/routes/dashboard/cards/card-parts';
import { useCardSample } from '@/routes/dashboard/cards/card-sample';
import { RoundButton } from '@/routes/dashboard/cards/control-parts';
import { cardTime, type EntityCardModel } from '@/routes/dashboard/cards/entity-model';

/**
 * Renders a picture card, at 2×2 or 2×3: the same drawing, taller.
 *
 * @param props - The card, ready to draw.
 * @param props.model - See {@link EntityCardModel}.
 * @returns The card.
 */
export function PictureCard(props: { readonly model: EntityCardModel }) {
  const { t } = useTranslation();

  const { model } = props;
  const { entity, state, title, changedAt } = model;
  const image = state.image;
  const sample = useCardSample();
  const fetched = useEntityImage(
    entity.entityId,
    sample === null ? (image?.revision ?? null) : null,
    image?.contentType ?? 'image/svg+xml',
  );
  const address = sample === null ? fetched : sample.still(entity.entityId);
  const [isLarge, setLarge] = useState(false);
  const caption = model.isOffline
    ? changedAt === null
      ? t('dashboard.cards.kit.unreachable', 'Not reachable')
      : t('dashboard.cards.kit.lastSeen', 'last seen {{time}}', { time: cardTime(changedAt) })
    : changedAt === null
      ? model.kind.label
      : t('dashboard.cards.picture.updated', '{{kind}} · updated {{when}}', {
          kind: model.kind.label,
          when: relativeTime(changedAt),
        });

  return (
    <CardFrame label={title} className="p-0">
      {address === null ? (
        <div className="absolute inset-0 flex -translate-y-4 flex-col items-center justify-center gap-2 text-foreground-subtle">
          <AppIcon id="image" size={36} />
          <Caption>
            {image === undefined
              ? t('dashboard.cards.picture.nothingYet', 'Nothing drawn yet')
              : t('dashboard.cards.picture.loading', 'Loading the picture…')}
          </Caption>
        </div>
      ) : (
        <img
          src={address}
          alt={title}
          className={cn(
            'absolute inset-0 size-full object-cover transition-opacity duration-300',
            model.isOffline && 'opacity-50',
          )}
        />
      )}
      <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-2.5 bg-linear-to-t from-canvas/85 to-transparent px-4 pt-6 pb-3.5">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate text-ui font-medium text-foreground">{title}</span>
          <Caption className="text-foreground-muted">{caption}</Caption>
        </div>
        {address === null ? null : (
          <RoundButton
            size={32}
            icon="maximize"
            label={t('dashboard.cards.picture.open', 'Open')}
            onPress={() => {
              setLarge(true);
            }}
          />
        )}
      </div>
      <Modal
        isOpen={isLarge}
        onClose={() => {
          setLarge(false);
        }}
        title={title}
        size="large"
      >
        {address === null ? null : (
          <img src={address} alt={title} className="max-h-[80vh] w-full object-contain" />
        )}
      </Modal>
    </CardFrame>
  );
}
