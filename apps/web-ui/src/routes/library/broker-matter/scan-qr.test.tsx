/**
 * The camera goes off with the dialog, even when the browser hands it over afterwards.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ScanQrButton } from './scan-qr';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ScanQrButton', () => {
  it('stops a camera granted after the dialog was cancelled', async () => {
    const stop = vi.fn();
    let grant: (stream: MediaStream) => void = () => undefined;

    vi.stubGlobal('isSecureContext', true);
    vi.stubGlobal(
      'BarcodeDetector',
      class {
        /**
         * Finds nothing.
         *
         * @returns No codes.
         */
        public async detect(): Promise<readonly { readonly rawValue: string }[]> {
          return Promise.resolve([]);
        }
      },
    );
    Object.defineProperty(globalThis.navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: async () =>
          new Promise<MediaStream>((resolve) => {
            grant = resolve;
          }),
      },
    });

    render(<ScanQrButton onCode={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: 'Scan QR' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    grant({ getTracks: () => [{ stop }] } as unknown as MediaStream);

    await waitFor(() => {
      expect(stop).toHaveBeenCalledOnce();
    });
  });
});
