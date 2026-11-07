/**
 * A picture an integration draws - a robot's map with its rooms and the path it took - as large as
 * the dialog allows, in its own proportions, with when it was last drawn and a way to see it full
 * screen.
 *
 * The bytes come from the entity's image endpoint, one revision at a time: the picture on screen
 * stays until the next has arrived, so a map redrawn every few seconds does not blink.
 */
import { useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { AppIcon } from '@nebulahome/ui';

import { useEntityImage } from '@/library/use-entity-image';
import { clockText } from '@/routes/library/entity/sheet/history';
import type { SheetBodyProps } from '@/routes/library/entity/sheet/sheet-types';

/**
 * The body of a picture.
 *
 * @param props - See {@link SheetBodyProps}.
 * @returns The body.
 */
export function ImageBody(props: SheetBodyProps) {
  const { t } = useTranslation();
  const { entity, state, disabled, now } = props;
  const image = state.image;
  const frame = useRef<HTMLDivElement>(null);
  const address = useEntityImage(
    entity.entityId,
    image?.revision ?? null,
    image?.contentType ?? 'image/svg+xml',
  );
  const drawnAt = entity.lastChanged?.getTime() ?? now;
  // Its own proportions when it says them, a landscape frame until then.
  const ratio =
    image?.width !== undefined && image.height !== undefined && image.height > 0
      ? image.width / image.height
      : 4 / 3;

  return (
    <div className="flex grow flex-col gap-4 pt-1">
      <div
        ref={frame}
        className="relative overflow-hidden rounded-card border border-border-strong bg-well"
        // eslint-disable-next-line react/forbid-dom-props -- the frame takes the picture's proportions
        style={{ aspectRatio: String(Math.min(2, Math.max(0.75, ratio))) }}
      >
        {address === null ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2.5 text-foreground-subtle">
            <AppIcon
              id={image === undefined ? 'image' : 'loader-circle'}
              size={26}
              className={image === undefined ? undefined : 'entity-spin'}
            />
            <span className="text-ui-sm">
              {image === undefined
                ? t('entity.sheet.image.nothingYet', 'Nothing drawn yet.')
                : t('entity.sheet.image.loading', 'Loading the picture…')}
            </span>
          </div>
        ) : (
          <img
            key={address}
            src={address}
            alt={entity.name}
            className="absolute inset-0 size-full animate-fade-in object-contain"
          />
        )}
      </div>
      <div className="flex items-center justify-between gap-3">
        <span className="text-ui-sm text-foreground-subtle">
          {image === undefined
            ? t('entity.sheet.image.none', 'No picture yet')
            : t('entity.sheet.image.drawnAt', 'Drawn at {{time}}', { time: clockText(drawnAt) })}
        </span>
        <button
          type="button"
          disabled={disabled || address === null}
          onClick={() => {
            void frame.current?.requestFullscreen();
          }}
          className="press inline-flex h-9 cursor-pointer items-center gap-2 rounded-pill border border-border-strong bg-surface-raised px-3.5 text-ui-sm font-medium text-foreground transition-colors duration-200 hover:border-foreground-subtle disabled:cursor-not-allowed disabled:opacity-50"
        >
          <AppIcon id="maximize-2" size={15} />
          {t('entity.sheet.image.fullScreen', 'Full screen')}
        </button>
      </div>
    </div>
  );
}
