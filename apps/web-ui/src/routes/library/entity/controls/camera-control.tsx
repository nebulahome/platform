/**
 * A camera: whether it is streaming, its last still, a new still, a clip.
 *
 * The still is shown when the camera has said where it is; the path is relative, because only
 * the page knows which origin it reached the house through. Taking one and recording are there
 * only for a camera that declared it can, and a clip is always of a bounded length - the contract
 * refuses an open-ended recording, and so does the control.
 */
import { useState } from 'react';

import { AppIcon, Badge, Button, Segmented } from '@nebula-home/ui';

import { paramsOf } from '@/library/entity-control';
import {
  ControlBlock,
  isBusy,
  type ControlProps,
} from '@/routes/library/entity/controls/control-block';

/** The clip lengths offered, in seconds. */
const LENGTHS = [
  { value: '10', label: '10 s' },
  { value: '30', label: '30 s' },
  { value: '60', label: '1 min' },
] as const;

/**
 * Renders the camera control.
 *
 * @param props - See {@link ControlProps}.
 * @returns The block.
 */
export function CameraControl(props: ControlProps) {
  const { entity, state, commander, disabled } = props;
  const params = paramsOf(entity, 'camera') ?? {
    hasSnapshot: true,
    hasStream: true,
    hasRecording: false,
  };
  const camera = state.camera;
  const [length, setLength] = useState<(typeof LENGTHS)[number]['value']>('30');
  const busy = isBusy(props, 'camera');

  return (
    <ControlBlock
      title="Camera"
      action={
        <span className="flex items-center gap-2">
          {camera?.isRecording === true ? (
            <Badge tone="danger" size="small" icon={<AppIcon id="circle-dot" size={11} />}>
              Recording
            </Badge>
          ) : null}
          <Badge tone={camera?.isStreamAvailable === true ? 'success' : 'neutral'} size="small">
            {camera?.isStreamAvailable === true ? 'Streaming' : 'No stream'}
          </Badge>
        </span>
      }
    >
      {camera?.snapshotPath === undefined ? null : (
        <img
          src={camera.snapshotPath}
          alt={`The last still from ${entity.name}`}
          className="aspect-video w-full rounded-field border border-border bg-sunk object-cover"
        />
      )}
      <div className="flex flex-wrap items-center gap-2">
        {params.hasSnapshot ? (
          <Button
            variant="ghost"
            disabled={disabled || busy}
            onClick={() => {
              commander.send('camera', { command: 'snapshot' });
            }}
          >
            <AppIcon id="camera" size={15} />
            Take a still
          </Button>
        ) : null}
        {params.hasRecording ? (
          <>
            <Segmented
              label="Clip length"
              size="compact"
              options={LENGTHS}
              value={length}
              disabled={disabled}
              onChange={setLength}
            />
            <Button
              variant="ghost"
              disabled={disabled || busy || camera?.isRecording === true}
              onClick={() => {
                commander.send('camera', { command: 'record', durationSeconds: Number(length) });
              }}
            >
              <AppIcon id="circle-dot" size={15} />
              Record
            </Button>
          </>
        ) : null}
      </div>
    </ControlBlock>
  );
}
