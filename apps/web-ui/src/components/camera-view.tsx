/**
 * A camera's live picture, and what stands in for it while there is none.
 *
 * A canvas the player draws in, filling the frame it is given; over it, while it connects or
 * when it cannot play, one line saying why - the browser lacks the decoder, the camera is not
 * streaming, the socket closed. Played only while `isPlaying` is true: a picture nobody looks at
 * costs the camera, the hub and the network for nothing.
 */
import { AppIcon, cn, IconButton } from '@nebula-home/ui';

import { useCameraStream } from '@/live/use-camera-stream';

/** What the view needs. */
export type CameraViewProps = {
  /** The camera. */
  readonly entityId: string;

  /** What it is called, for the canvas's label. */
  readonly name: string;

  /** Whether to play now. */
  readonly isPlaying: boolean;

  /** Whether the camera says it can stream now; when it says not, nothing is asked of it. */
  readonly isStreamAvailable: boolean;

  /** Anything extra for the frame. */
  readonly className?: string;
};

/**
 * Renders the view.
 *
 * @param props - See {@link CameraViewProps}.
 * @returns The view.
 */
export function CameraView(props: CameraViewProps) {
  const { entityId, name, isPlaying, isStreamAvailable, className } = props;
  const { setCanvas, status, message, showFullScreen } = useCameraStream(
    entityId,
    isPlaying && isStreamAvailable,
  );
  const note = !isStreamAvailable
    ? 'The camera is not streaming now'
    : status === 'connecting'
      ? 'Connecting…'
      : status === 'playing' || status === 'idle'
        ? null
        : (message ?? 'The stream stopped');

  return (
    <div className={cn('relative overflow-hidden bg-sunk', className)}>
      <canvas
        ref={setCanvas}
        aria-label={`Live picture from ${name}`}
        role="img"
        className={cn(
          'size-full object-contain',
          status === 'playing' ? 'opacity-100' : 'opacity-0',
        )}
      />
      {note === null ? null : (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-4 text-center text-foreground-subtle">
          <AppIcon id={isStreamAvailable ? 'video' : 'video-off'} size={28} />
          <span role="status" className="text-caption">
            {note}
          </span>
        </div>
      )}
      {status === 'playing' ? (
        <IconButton
          label="Full screen"
          variant="raised"
          size="small"
          className="absolute top-2 left-2"
          onClick={() => {
            showFullScreen();
          }}
        >
          <AppIcon id="maximize" size={13} />
        </IconButton>
      ) : null}
    </div>
  );
}
