/**
 * Turning a file somebody chose into something small enough to store.
 *
 * The resizing happens here, in the browser, and that is the decision that makes the whole
 * feature cheap: a phone photograph is several megabytes, and what the database keeps is a
 * 128-pixel square measured in kilobytes. Sending the original and resizing on the server would
 * mean an image decoder in `api` - a large thing to point at untrusted input - for no benefit,
 * since the browser already has one and is already displaying the file.
 *
 * The image is centre-cropped rather than squashed. A face stretched to fit a square is worse
 * than a face with its edges trimmed, and every place an avatar appears is round anyway.
 *
 * WebP first, PNG if the browser cannot encode it. Quality steps down until the result fits,
 * rather than failing: somebody who picked a photograph of a window on a bright day should get a
 * slightly softer picture, not a refusal.
 */
import { AVATAR_MAXIMUM_BYTES, AVATAR_PIXELS, type AvatarMimeType } from '@nebulahome/contracts';

import { translate } from '@/i18n/messages';

/** The quality settings tried in order, until one produces a small enough file. */
const QUALITY_STEPS: readonly number[] = [0.85, 0.7, 0.55, 0.4];

/** What is ready to be sent. */
export type AvatarUpload = {
  /** The format the bytes are in. */
  readonly mime: AvatarMimeType;

  /** The image, base64 encoded. */
  readonly data: string;
};

/** The part of a source image that becomes the square. */
export type SourceCrop = {
  /** Distance from the left edge. */
  readonly x: number;

  /** Distance from the top edge. */
  readonly y: number;

  /** The side of the square, in source pixels. */
  readonly side: number;
};

/**
 * Works out the largest centred square inside an image.
 *
 * @param width - The source width.
 * @param height - The source height.
 * @returns Where to read from.
 */
export function centreCrop(width: number, height: number): SourceCrop {
  const side = Math.min(width, height);

  return { x: (width - side) / 2, y: (height - side) / 2, side };
}

/**
 * Reads a file into something that can be drawn.
 *
 * @param file - What was chosen.
 * @returns The decoded image.
 * @throws {Error} When the browser cannot decode it, which is what happens to a `.heic` from an
 * iPhone and to a file that is not an image at all whatever it is called.
 */
async function decode(file: File): Promise<ImageBitmap> {
  try {
    return await globalThis.createImageBitmap(file);
  } catch (cause: unknown) {
    throw new Error(
      translate('settings.avatar.unreadable', 'That file could not be read as an image'),
      {
        cause,
      },
    );
  }
}

/**
 * Encodes a canvas, smallest acceptable quality first.
 *
 * @param canvas - What to encode.
 * @param mime - The format to try.
 * @returns The bytes, or null when every quality step was still too large.
 */
async function encode(canvas: HTMLCanvasElement, mime: AvatarMimeType): Promise<Blob | null> {
  for (const quality of QUALITY_STEPS) {
    // Sequential on purpose: each step exists only because the one before it was too big, so
    // encoding them all in parallel would be four times the work to throw three away.
    // eslint-disable-next-line no-await-in-loop -- see above
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, mime, quality);
    });

    if (blob !== null && blob.type === mime && blob.size <= AVATAR_MAXIMUM_BYTES) {
      return blob;
    }

    // A browser that cannot encode this format hands back a PNG regardless of what was asked
    // for. There is no point walking the quality steps of a format it is not using.
    if (blob !== null && blob.type !== mime) {
      return null;
    }
  }

  return null;
}

/**
 * Prepares a chosen file for upload.
 *
 * @param file - What the person picked.
 * @returns The resized image, ready for the API.
 * @throws {Error} When the file cannot be decoded, when the browser has no 2D canvas, or when
 * even the lowest quality is still too large - which at 128 pixels means something has gone
 * wrong rather than that the picture was ambitious.
 */
export async function toAvatarUpload(file: File): Promise<AvatarUpload> {
  const bitmap = await decode(file);
  const crop = centreCrop(bitmap.width, bitmap.height);
  const canvas = globalThis.document.createElement('canvas');

  canvas.width = AVATAR_PIXELS;
  canvas.height = AVATAR_PIXELS;

  const context = canvas.getContext('2d');

  if (context === null) {
    throw new Error(translate('settings.avatar.noCanvas', 'This browser cannot resize images'));
  }

  context.drawImage(
    bitmap,
    crop.x,
    crop.y,
    crop.side,
    crop.side,
    0,
    0,
    AVATAR_PIXELS,
    AVATAR_PIXELS,
  );
  bitmap.close();

  const blob = (await encode(canvas, 'image/webp')) ?? (await encode(canvas, 'image/png'));

  if (blob === null) {
    throw new Error(
      translate('settings.avatar.tooBig', 'That image could not be made small enough'),
    );
  }

  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';

  for (const byte of bytes) {
    binary += String.fromCodePoint(byte);
  }

  return {
    // Narrowed by construction: `encode` returns null unless the blob's type is the one asked
    // for, and both calls above ask for a type from the contract's list.
    mime: blob.type === 'image/webp' ? 'image/webp' : 'image/png',
    data: globalThis.btoa(binary),
  };
}
