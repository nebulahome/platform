/**
 * An image entity: the picture its integration draws - a robot's map with the rooms, the path it
 * took and where it is now - shown as large as the page allows, and a click away from full size.
 *
 * The picture follows the entity's live state: each new revision is fetched once, and the one on
 * screen stays until the next has arrived, so a map redrawn every few seconds does not blink.
 */
import { useState } from 'react';

import { AppIcon, IconButton, Modal } from '@nebulahome/ui';

import { useEntityImage } from '@/library/use-entity-image';
import { ControlBlock, type ControlProps } from '@/routes/library/entity/controls/control-block';

/**
 * Renders the image control.
 *
 * @param props - See {@link ControlProps}.
 * @returns The block.
 */
export function ImageControl(props: ControlProps) {
  const { entity, state } = props;
  const image = state.image;
  const address = useEntityImage(
    entity.entityId,
    image?.revision ?? null,
    image?.contentType ?? 'image/svg+xml',
  );
  const [isLarge, setLarge] = useState(false);

  return (
    <ControlBlock
      title="Picture"
      value={
        address === null ? (
          '—'
        ) : (
          <IconButton
            label="Show it full size"
            onClick={() => {
              setLarge(true);
            }}
          >
            <AppIcon id="maximize" size={15} />
          </IconButton>
        )
      }
    >
      {address === null ? (
        <p className="text-ui text-foreground-subtle">
          {image === undefined ? 'Nothing drawn yet.' : 'Loading the picture…'}
        </p>
      ) : (
        <img
          src={address}
          alt={entity.name}
          className="max-h-[28rem] w-full rounded-field border border-border bg-canvas object-contain"
        />
      )}

      <Modal
        isOpen={isLarge}
        onClose={() => {
          setLarge(false);
        }}
        title={entity.name}
        size="large"
      >
        {address === null ? null : (
          <img src={address} alt={entity.name} className="max-h-[80vh] w-full object-contain" />
        )}
      </Modal>
    </ControlBlock>
  );
}
