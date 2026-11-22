/**
 * A camera: its picture, filling the card.
 *
 * The picture is the card: the name and whether it is live over its top, the picture's time and
 * the buttons under it. A stream runs only while it is watched, so the card shows the camera's
 * latest still, fetched with the session's credentials and again every so often, and plays live
 * once Full screen is pressed, until full screen is left. The tall card is the same, larger, with
 * Record for a camera that records.
 *
 * What the camera cannot do is not drawn (`K-Capabilities`): one without a stream says SNAPSHOT
 * and offers Refresh in place of Snapshot; one that does not record has no Record. The board's
 * row of recorded events is not drawn either: nothing the hub serves lists a camera's events, so
 * the tall card keeps its picture whole.
 */
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { AppIcon, cn, IconButton } from '@nebulahome/ui';

import { CameraView } from '@/components/camera-view';
import { dateTimeFormat } from '@/i18n/formatters';
import { paramsOf } from '@/library/entity-control';
import { PICTURE_QUERY_KEYS } from '@/library/use-entity-image';
import { CommandNote, NoAnswer } from '@/routes/dashboard/cards/card-kit';
import { CardFrame } from '@/routes/dashboard/cards/card-parts';
import { canUse, sizeKey, type EntityCardModel } from '@/routes/dashboard/cards/entity-model';
import { useCameraStill } from '@/routes/dashboard/cards/use-camera-still';

/** How long a clip Record asks for, in seconds: the entity dialog's own default. */
const CLIP_SECONDS = 30;

/** A round button on the picture. */
const ROUND = 'size-8 text-foreground disabled:opacity-40';

/**
 * Renders a camera card.
 *
 * @param props - The card, ready to draw.
 * @param props.model - See {@link EntityCardModel}.
 * @returns The card.
 */
export function CameraCard(props: { readonly model: EntityCardModel }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const { model } = props;
  const { entity, state, title, command } = model;
  const box = useRef<HTMLDivElement>(null);
  const [isPlaying, setPlaying] = useState(false);
  const [sent, setSent] = useState<'snapshot' | 'record'>('snapshot');
  const params = paramsOf(entity, 'camera');
  const camera = state.camera;
  const isLive = params?.hasStream !== false && camera?.isStreamAvailable === true;
  const canRecord = params?.hasRecording === true && sizeKey(model.size) === '2x3';
  const still = useCameraStill(
    entity.entityId,
    params?.hasSnapshot !== false && !isPlaying && !model.isOffline,
  );
  // When the still was fetched: a sample's, never fetched, is of now.
  const fetchedAt =
    queryClient.getQueryState([...PICTURE_QUERY_KEYS.cameraStill, entity.entityId])
      ?.dataUpdatedAt ?? 0;
  const disabled = !canUse(model, 'camera');

  // A stream runs only while it is watched: leaving full screen stops it.
  useEffect(() => {
    /** Stops the stream once nothing is full screen. */
    const leave = (): void => {
      if (document.fullscreenElement === null) {
        setPlaying(false);
      }
    };

    document.addEventListener('fullscreenchange', leave);

    return (): void => {
      document.removeEventListener('fullscreenchange', leave);
    };
  }, []);

  /** Shows the picture full screen, live when the camera streams; or stops watching. */
  const watch = (): void => {
    if (isPlaying) {
      setPlaying(false);

      if (document.fullscreenElement !== null) {
        void document.exitFullscreen();
      }

      return;
    }

    setPlaying(isLive);
    // Refused (a phone that only lets a video go full screen), it plays in the card.
    void box.current?.requestFullscreen().catch(() => undefined);
  };

  /**
   * Asks the camera for a still or a clip.
   *
   * @param what - Which.
   */
  const ask = (what: 'snapshot' | 'record'): void => {
    setSent(what);
    command.send(
      'camera',
      what === 'record'
        ? { command: 'record', durationSeconds: CLIP_SECONDS }
        : { command: 'snapshot' },
    );
  };

  const badge = model.isOffline
    ? {
        word: t('dashboard.cards.kit.offline', 'Offline'),
        color: 'text-foreground-muted',
        dot: false,
      }
    : camera?.isRecording === true
      ? { word: t('dashboard.cards.cameraCard.rec', 'Rec'), color: 'text-danger', dot: true }
      : isLive
        ? { word: t('dashboard.cards.cameraCard.live', 'Live'), color: 'text-success', dot: true }
        : {
            word: t('dashboard.cards.cameraCard.snapshot', 'Snapshot'),
            color: 'text-foreground-muted',
            dot: false,
          };
  const time =
    still === null
      ? null
      : dateTimeFormat({ hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(
          fetchedAt > 0 ? new Date(fetchedAt) : new Date(),
        );

  return (
    <CardFrame label={title} className="p-0">
      <div ref={box} className="relative min-h-0 grow overflow-hidden bg-surface-raised">
        {isPlaying ? (
          <CameraView
            entityId={entity.entityId}
            name={title}
            isPlaying
            isStreamAvailable={isLive}
            className="absolute inset-0"
          />
        ) : still === null ? (
          <div className="absolute inset-0 flex items-center justify-center text-foreground-subtle">
            <AppIcon id="camera" size={44} />
          </div>
        ) : (
          <img
            src={still}
            alt={t(
              'dashboard.cards.cameraCard.latestStillFromTitle',
              'The latest still from {{title}}',
              { title },
            )}
            className={cn(
              'absolute inset-0 size-full object-cover',
              model.isOffline && 'opacity-60',
            )}
          />
        )}

        <div className="absolute inset-x-0 top-0 flex items-center justify-between gap-2.5 bg-linear-to-b from-canvas/70 to-transparent px-4 pt-3.5 pb-6">
          <span className="flex min-w-0 items-center gap-2 text-ui font-medium text-foreground">
            <AppIcon id="video" size={16} />
            <span className="truncate">{title}</span>
          </span>
          <span className="flex shrink-0 items-center gap-2">
            {model.canControl ? null : (
              <span
                className="inline-flex text-foreground-subtle"
                title={t('dashboard.cards.kit.viewOnly', 'View only')}
              >
                <AppIcon id="eye" size={14} />
              </span>
            )}
            <span
              className={cn(
                'inline-flex h-5.5 items-center gap-1.5 rounded-pill bg-canvas/60 px-2 font-mono text-label tracking-[0.06em] uppercase transition-colors duration-200',
                badge.color,
              )}
            >
              {badge.dot ? (
                <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-current" />
              ) : null}
              {badge.word}
            </span>
          </span>
        </div>

        <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-2.5 bg-linear-to-t from-canvas/80 to-transparent px-4 pt-6 pb-3.5">
          {command.hasFailed ? (
            <span className="grow">
              <NoAnswer command={command} />
            </span>
          ) : (
            <>
              <CommandNote
                command={command}
                sending={
                  sent === 'record'
                    ? t('dashboard.cards.cameraCard.startingClip', 'Starting a clip…')
                    : t('dashboard.cards.cameraCard.takingStill', 'Taking a still…')
                }
              >
                <span className="font-mono text-ui-sm text-foreground tabular-nums">{time}</span>
              </CommandNote>
              <div className="flex shrink-0 gap-1.5">
                {model.canControl && canRecord ? (
                  <IconButton
                    variant="raised"
                    size={null}
                    label={t('dashboard.cards.cameraCard.record', 'Record')}
                    className={ROUND}
                    disabled={disabled || camera?.isRecording === true}
                    onClick={() => {
                      ask('record');
                    }}
                  >
                    <AppIcon id="circle-dot" size={16} />
                  </IconButton>
                ) : null}
                {model.canControl && params?.hasSnapshot !== false ? (
                  <IconButton
                    variant="raised"
                    size={null}
                    label={
                      isLive
                        ? t('dashboard.cards.cameraCard.snapshot', 'Snapshot')
                        : t('dashboard.cards.cameraCard.refresh', 'Refresh')
                    }
                    className={ROUND}
                    disabled={disabled}
                    onClick={() => {
                      ask('snapshot');
                    }}
                  >
                    <AppIcon id={isLive ? 'camera' : 'refresh-cw'} size={16} />
                  </IconButton>
                ) : null}
                <IconButton
                  variant="raised"
                  size={null}
                  label={
                    isPlaying
                      ? t(
                          'dashboard.cards.cameraCard.stopWatchingTitle',
                          'Stop watching {{title}}',
                          {
                            title,
                          },
                        )
                      : t('dashboard.cards.cameraCard.fullScreen', 'Full screen')
                  }
                  className={ROUND}
                  disabled={model.isOffline}
                  onClick={watch}
                >
                  <AppIcon id={isPlaying ? 'square' : 'maximize'} size={16} />
                </IconButton>
              </div>
            </>
          )}
        </div>
      </div>
    </CardFrame>
  );
}
