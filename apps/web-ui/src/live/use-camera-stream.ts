/**
 * A camera's live picture in a canvas, while a component shows it.
 *
 * Opens the camera's socket when the component asks to play and closes it when it stops or goes
 * away: a stream runs only while somebody is looking at it. The canvas is handed over through a
 * callback ref, so the stream starts once there is somewhere to draw.
 */
import { useEffect, useState } from 'react';

import { useSession } from '@/auth/session-store';
import { CameraPlayer, cameraSocketUrl, type CameraPlayerStatus } from '@/live/camera-player';

/** What the hook gives. */
export type CameraStream = {
  /** Takes the canvas to draw in, as a `ref`. */
  readonly setCanvas: (canvas: HTMLCanvasElement | null) => void;

  /** Where the player stands; `idle` while not asked to play. */
  readonly status: CameraPlayerStatus | 'idle';

  /** Why, when it stopped or could not start. */
  readonly message: string | null;

  /** Shows the picture on the whole screen, where the browser allows it. */
  readonly showFullScreen: () => void;
};

/**
 * Plays a camera while asked to.
 *
 * @param entityId - The camera.
 * @param isPlaying - Whether to play now.
 * @returns The ref for the canvas to draw in, and where the player stands.
 */
export function useCameraStream(entityId: string, isPlaying: boolean): CameraStream {
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);
  const [status, setStatus] = useState<CameraPlayerStatus>('connecting');
  const [message, setMessage] = useState<string | null>(null);
  const isRunning = isPlaying && canvas !== null;

  useEffect(() => {
    if (!isPlaying || canvas === null) {
      return undefined;
    }

    const player = new CameraPlayer({
      url: cameraSocketUrl(entityId),
      /**
       * Reads the session's access token as it is now.
       *
       * @returns The token.
       */
      readAccessToken: () => useSession.getState().accessToken,
      canvas,

      /**
       * Keeps where the player stands, and why.
       *
       * @param next - Where it stands now.
       * @param reason - Why, when it stopped or could not start.
       */
      onStatus: (next, reason) => {
        setStatus(next);
        setMessage(reason ?? null);
      },
    });

    player.start();

    return (): void => {
      player.stop();
    };
  }, [entityId, isPlaying, canvas]);

  return {
    setCanvas,
    status: isRunning ? status : 'idle',
    message: isRunning ? message : null,

    /** Asks for the whole screen, and says nothing when it is refused. */
    showFullScreen: () => {
      void canvas?.requestFullscreen().catch(() => undefined);
    },
  };
}
