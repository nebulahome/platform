/**
 * A camera: its picture, filling the card.
 *
 * The frame is the card. A camera plays live once somebody presses play - a stream runs only
 * while it is watched - and stops when the card goes away. Before that, a camera that sends
 * stills shows its latest one, fetched with the session's credentials; one that sends video has
 * no still to show, since its picture exists only once the browser decodes it, and shows its
 * name and the play button. Whether it is streaming is said in words on the frame.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { AppIcon, Badge, Button } from '@nebulahome/ui';

import { CameraView } from '@/components/camera-view';
import { paramsOf } from '@/library/entity-control';
import type { EntityCardModel } from '@/routes/dashboard/cards/entity-model';
import { useCameraStill } from '@/routes/dashboard/cards/use-camera-still';

/**
 * Renders a camera card.
 *
 * @param props - The card, ready to draw.
 * @param props.model - See {@link EntityCardModel}.
 * @returns The card.
 */
export function CameraCard(props: { readonly model: EntityCardModel }) {
  const { t } = useTranslation();

  const { model } = props;
  const { entity, state, title, subtitle } = model;
  const camera = state.camera;
  const isAvailable = camera?.isStreamAvailable === true;
  const hasStill = paramsOf(entity, 'camera')?.hasSnapshot ?? false;
  const [isPlaying, setPlaying] = useState(false);
  const still = useCameraStill(entity.entityId, hasStill && isAvailable && !isPlaying);

  return (
    <article
      aria-label={title}
      className="relative h-full min-w-0 overflow-hidden rounded-panel border border-border bg-surface-raised"
    >
      {isPlaying ? (
        <CameraView
          entityId={entity.entityId}
          name={title}
          isPlaying
          isStreamAvailable={isAvailable}
          className="absolute inset-0"
        />
      ) : still === null ? (
        <div className="absolute inset-0 flex -translate-y-3 flex-col items-center justify-center gap-3 text-foreground-subtle">
          <AppIcon id="camera" size={44} />
          <span className="text-caption">
            {isAvailable
              ? t('dashboard.cards.cameraCard.pressPlayToWatch', 'Press play to watch')
              : t('dashboard.cards.cameraCard.notStreaming', 'Not streaming')}
          </span>
        </div>
      ) : (
        <img
          src={still}
          alt={t(
            'dashboard.cards.cameraCard.latestStillFromTitle',
            'The latest still from {{title}}',
            { title },
          )}
          className="absolute inset-0 size-full object-cover"
        />
      )}

      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-28 bg-gradient-to-b from-transparent to-black/80" />

      <div className="absolute top-3.5 right-3.5 flex gap-2">
        {camera?.isRecording === true ? (
          <Badge tone="danger" size="small" icon={<AppIcon id="circle-dot" size={11} />}>
            {t('dashboard.cards.cameraCard.recording', 'Recording')}
          </Badge>
        ) : null}
        <Badge tone={isPlaying ? 'success' : 'neutral'} size="small">
          {isPlaying
            ? t('dashboard.cards.cameraCard.live', 'Live')
            : isAvailable
              ? t('dashboard.cards.cameraCard.streaming', 'Streaming')
              : t('dashboard.cards.cameraCard.noStream', 'No stream')}
        </Badge>
      </div>

      <div className="absolute inset-x-4 bottom-3.5 flex items-end justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate text-subhead font-medium text-white">{title}</span>
          {subtitle === null ? null : (
            <span className="truncate text-caption text-white/70">{subtitle}</span>
          )}
        </div>
        {isAvailable ? (
          <Button
            variant="ghost"
            size="compact"
            aria-label={
              isPlaying
                ? t('dashboard.cards.cameraCard.stopWatchingTitle', 'Stop watching {{title}}', {
                    title,
                  })
                : t('dashboard.cards.cameraCard.watchTitleLive', 'Watch {{title}} live', { title })
            }
            onClick={() => {
              setPlaying(!isPlaying);
            }}
          >
            <AppIcon id={isPlaying ? 'square' : 'play'} size={14} />
            {isPlaying
              ? t('dashboard.cards.cameraCard.stop', 'Stop')
              : t('dashboard.cards.cameraCard.live', 'Live')}
          </Button>
        ) : null}
      </div>
    </article>
  );
}
