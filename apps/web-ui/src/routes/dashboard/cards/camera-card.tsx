/**
 * A camera: its last still, filling the card.
 *
 * The frame is the card. The platform keeps a still, not a stream, so the card shows the last one
 * the camera took and offers to take another; a camera that has none yet shows an empty frame that
 * says so, rather than a rectangle that reads as unfinished. Whether it is streaming or recording
 * is said in words on the frame.
 */
import { AppIcon, Badge, Button } from '@nebula-home/ui';

import { paramsOf } from '@/library/entity-control';
import type { EntityCardModel } from '@/routes/dashboard/cards/entity-model';
import { useEntityCommand } from '@/routes/library/entity/use-entity-command';

/**
 * Renders a camera card.
 *
 * @param props - The card, ready to draw.
 * @param props.model - See {@link EntityCardModel}.
 * @returns The card.
 */
export function CameraCard(props: { readonly model: EntityCardModel }) {
  const { model } = props;
  const { entity, state, title, subtitle } = model;
  const commander = useEntityCommand(entity.entityId);
  const camera = state.camera;
  const canSnapshot = paramsOf(entity, 'camera')?.hasSnapshot ?? true;

  return (
    <article
      aria-label={title}
      className="relative h-full min-w-0 overflow-hidden rounded-panel border border-border bg-sunk"
    >
      {camera?.snapshotPath === undefined ? (
        <div className="absolute inset-0 flex -translate-y-3 flex-col items-center justify-center gap-3 text-foreground-subtle">
          <AppIcon id="camera" size={44} />
          <span className="text-caption">Waiting for a first still</span>
        </div>
      ) : (
        <img
          src={camera.snapshotPath}
          alt={`The last still from ${title}`}
          className="absolute inset-0 size-full object-cover"
        />
      )}

      <div className="absolute inset-x-0 bottom-0 h-28 bg-gradient-to-b from-transparent to-black/80" />

      <div className="absolute top-3.5 right-3.5 flex gap-2">
        {camera?.isRecording === true ? (
          <Badge tone="danger" size="small" icon={<AppIcon id="circle-dot" size={11} />}>
            Recording
          </Badge>
        ) : null}
        <Badge tone={camera?.isStreamAvailable === true ? 'success' : 'neutral'} size="small">
          {camera?.isStreamAvailable === true ? 'Streaming' : 'No stream'}
        </Badge>
      </div>

      <div className="absolute inset-x-4 bottom-3.5 flex items-end justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate text-subhead font-medium text-white">{title}</span>
          {subtitle === null ? null : (
            <span className="truncate text-caption text-white/70">{subtitle}</span>
          )}
        </div>
        {canSnapshot ? (
          <Button
            variant="ghost"
            size="compact"
            disabled={!model.canControl || commander.busy.has('camera')}
            onClick={() => {
              commander.send('camera', { command: 'snapshot' });
            }}
          >
            <AppIcon id="camera" size={14} />
            Snapshot
          </Button>
        ) : null}
      </div>
    </article>
  );
}
