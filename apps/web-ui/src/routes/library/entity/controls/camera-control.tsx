/**
 * A camera: its live picture, and a clip where the camera can record one.
 *
 * On the camera's own page the picture plays at once - that is what the page was opened for - and
 * a button stops it and starts it again; the stream stops with the page. The picture is decoded
 * by the browser from what the camera sends, so what is on the screen is what the camera sees,
 * a moment late. Recording is there only for a camera that declared it can, and a clip is always
 * of a bounded length - the contract refuses an open-ended recording, and so does the control.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { AppIcon, Badge, Button, Segmented } from '@nebulahome/ui';

import { CameraView } from '@/components/camera-view';
import { defineMessage, text } from '@/i18n/messages';
import { paramsOf } from '@/library/entity-control';
import {
  ControlBlock,
  isBusy,
  type ControlProps,
} from '@/routes/library/entity/controls/control-block';

/** The clip lengths offered, in seconds. */
const LENGTHS = [
  { value: '10', label: defineMessage('entity.controls.cameraControl.n10S', '10 s') },
  { value: '30', label: defineMessage('entity.controls.cameraControl.n30S', '30 s') },
  { value: '60', label: defineMessage('entity.controls.cameraControl.n1Min', '1 min') },
] as const;

/**
 * Renders the camera control.
 *
 * @param props - See {@link ControlProps}.
 * @returns The block.
 */
export function CameraControl(props: ControlProps) {
  const { t } = useTranslation();

  const { entity, state, commander, disabled } = props;
  const params = paramsOf(entity, 'camera') ?? {
    hasSnapshot: false,
    hasStream: true,
    hasRecording: false,
  };
  const camera = state.camera;
  const isAvailable = camera?.isStreamAvailable === true;
  const [length, setLength] = useState<(typeof LENGTHS)[number]['value']>('30');
  const [isPlaying, setPlaying] = useState(true);
  const busy = isBusy(props, 'camera');

  return (
    <ControlBlock
      title={t('entity.controls.cameraControl.camera', 'Camera')}
      action={
        <span className="flex items-center gap-2">
          {camera?.isRecording === true ? (
            <Badge tone="danger" size="small" icon={<AppIcon id="circle-dot" size={11} />}>
              {t('entity.controls.cameraControl.recording', 'Recording')}
            </Badge>
          ) : null}
          <Badge tone={isAvailable ? 'success' : 'neutral'} size="small">
            {isAvailable
              ? t('entity.controls.cameraControl.streaming', 'Streaming')
              : t('entity.controls.cameraControl.noStream', 'No stream')}
          </Badge>
        </span>
      }
    >
      {params.hasStream ? (
        <CameraView
          entityId={entity.entityId}
          name={entity.name}
          isPlaying={isPlaying}
          isStreamAvailable={isAvailable}
          className="aspect-video w-full rounded-field border border-border"
        />
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        {params.hasStream && isAvailable ? (
          <Button
            variant="ghost"
            onClick={() => {
              setPlaying(!isPlaying);
            }}
          >
            <AppIcon id={isPlaying ? 'square' : 'play'} size={15} />
            {isPlaying
              ? t('entity.controls.cameraControl.stop', 'Stop')
              : t('entity.controls.cameraControl.watchLive', 'Watch live')}
          </Button>
        ) : null}
        {params.hasRecording ? (
          <>
            <Segmented
              label={t('entity.controls.cameraControl.clipLength', 'Clip length')}
              size="compact"
              options={LENGTHS.map((option) => ({ ...option, label: text(option.label) }))}
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
              {t('entity.controls.cameraControl.record', 'Record')}
            </Button>
          </>
        ) : null}
      </div>
    </ControlBlock>
  );
}
