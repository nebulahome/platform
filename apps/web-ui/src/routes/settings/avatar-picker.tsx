/**
 * Choosing a picture for an account.
 *
 * The file input is hidden behind a real button rather than styled, because a styled
 * `<input type="file">` is a fight with every browser and the native control's label is the one
 * thing nobody can change. The button is what gets the focus ring; the input is only the
 * mechanism.
 *
 * Everything expensive happens before the request: the file is decoded, centre-cropped and
 * re-encoded to a 128-pixel square in the browser, so what is sent is a few kilobytes rather
 * than whatever came off a phone. That is also why a failure here is usually not the server's -
 * a `.heic` from an iPhone cannot be decoded by most browsers, and the message says so instead
 * of blaming the upload.
 */
import { useRef, useState } from 'react';

import { Button } from '@nebula-home/ui';

import { Avatar } from '@/components/avatar';
import { Hint } from '@/components/hint';
import { removeAvatar, setAvatar } from '@/settings/api';
import { toAvatarUpload } from '@/settings/avatar-image';

/** What the picker explains when asked. */
const EXPLANATION =
  'Any image your browser can open. It is cropped to a square and shrunk to 128 pixels before ' +
  'it is sent, then kept in the database so it is part of your backup. A photo straight from an ' +
  'iPhone may not open — export it as JPEG first.';

/** What the picker needs. */
export type AvatarPickerProps = {
  /** Whose account. */
  readonly userId: string;

  /** Their name, for the initials shown when there is no picture. */
  readonly displayName: string;

  /** Their current picture, or null. */
  readonly avatarUrl: string | null;

  /** Called once the server has accepted a change, so the caller can re-read. */
  readonly onChanged: () => void | Promise<void>;
};

/**
 * Renders the picker.
 *
 * @param props - See {@link AvatarPickerProps}.
 * @returns The control.
 */
export function AvatarPicker(props: AvatarPickerProps) {
  const { userId, displayName, avatarUrl, onChanged } = props;
  const input = useRef<HTMLInputElement>(null);
  const [isBusy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  /**
   * Resizes a chosen file and sends it.
   *
   * @param file - What was picked.
   */
  const upload = (file: File): void => {
    setError(undefined);
    setBusy(true);

    void (async (): Promise<void> => {
      try {
        await setAvatar(userId, await toAvatarUpload(file));
        await onChanged();
      } catch (cause: unknown) {
        setError(cause instanceof Error ? cause.message : 'That picture could not be used.');
      } finally {
        setBusy(false);
      }
    })();
  };

  /**
   * Removes the picture.
   */
  const clear = (): void => {
    setError(undefined);
    setBusy(true);

    void (async (): Promise<void> => {
      try {
        await removeAvatar(userId);
        await onChanged();
      } catch (cause: unknown) {
        setError(cause instanceof Error ? cause.message : 'That picture could not be removed.');
      } finally {
        setBusy(false);
      }
    })();
  };

  return (
    <div className="flex items-center gap-4">
      <Avatar displayName={displayName} avatarUrl={avatarUrl} size="large" />

      <div className="flex min-w-0 flex-col items-start gap-2">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            className="h-8 px-3 text-[13px]"
            isBusy={isBusy}
            onClick={() => {
              input.current?.click();
            }}
          >
            {avatarUrl === null ? 'Choose a picture' : 'Replace'}
          </Button>

          {avatarUrl === null ? null : (
            <Button
              variant="danger"
              className="h-8 px-3 text-[13px]"
              disabled={isBusy}
              onClick={clear}
            >
              Remove
            </Button>
          )}

          <Hint text={EXPLANATION} />
        </div>

        {error === undefined ? (
          <span className="text-[11.5px] text-foreground-subtle">
            Cropped to a square and shrunk before it is sent.
          </span>
        ) : (
          <span role="alert" className="text-[11.5px] text-danger">
            {error}
          </span>
        )}
      </div>

      <input
        ref={input}
        type="file"
        accept="image/*"
        className="sr-only"
        // Named for a screen reader that reaches it directly: it is visually hidden, not
        // removed, so it is still in the tab order behind the button that clicks it.
        aria-label="Choose a picture"
        onChange={(event) => {
          const file = event.target.files?.[0];

          if (file !== undefined) {
            upload(file);
          }

          // Cleared so that choosing the same file twice in a row still fires a change.
          event.target.value = '';
        }}
      />
    </div>
  );
}
