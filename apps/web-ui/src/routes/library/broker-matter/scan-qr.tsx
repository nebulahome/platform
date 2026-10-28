/**
 * Scan QR: a new Matter device's code read from its QR code with the browser's camera.
 *
 * The camera is the browser's only on a secure page, so on plain HTTP the button is disabled and
 * says to open Nebula over HTTPS; typing the code always works. The code is read with the
 * browser's own barcode detector where it has one; one that has none says so.
 */
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { AppIcon, Button, Modal, Note } from '@nebulahome/ui';

/** How often a frame is looked at for a code. */
const SCAN_MS = 300;

/** The browser's barcode detector, where it has one. */
type Detector = {
  readonly detect: (source: HTMLVideoElement) => Promise<readonly { readonly rawValue: string }[]>;
};

/** What builds a detector. */
type DetectorClass = new (options: { readonly formats: readonly string[] }) => Detector;

/**
 * The browser's barcode detector, when it has one.
 *
 * @returns Its class, or undefined.
 */
function detectorClass(): DetectorClass | undefined {
  return (globalThis as { BarcodeDetector?: DetectorClass }).BarcodeDetector;
}

/** What the button needs. */
export type ScanQrButtonProps = {
  /** Called with the QR code's text: `MT:…`. */
  readonly onCode: (code: string) => void;
};

/**
 * Renders the button, and the camera while it scans.
 *
 * @param props - See {@link ScanQrButtonProps}.
 * @returns The button.
 */
export function ScanQrButton(props: ScanQrButtonProps) {
  const { t } = useTranslation();
  const [isScanning, setScanning] = useState(false);
  const isSecure = globalThis.isSecureContext;

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button
        variant="ghost"
        disabled={!isSecure}
        onClick={() => {
          setScanning(true);
        }}
      >
        <AppIcon id="qr-code" size={15} />
        {t('brokers.matter.scan.button', 'Scan QR')}
      </Button>
      {isSecure ? null : (
        <span className="text-caption text-foreground-subtle">
          {t('brokers.matter.scan.https', 'Open Nebula over HTTPS to scan')}
        </span>
      )}
      {isScanning ? (
        <Scanner
          onClose={() => {
            setScanning(false);
          }}
          onCode={(code) => {
            setScanning(false);
            props.onCode(code);
          }}
        />
      ) : null}
    </div>
  );
}

/**
 * The camera, looked at until a Matter QR code shows.
 *
 * @param props - What it does with the code, and how it closes.
 * @param props.onCode - Called with the code.
 * @param props.onClose - Closes it.
 * @returns The dialog.
 */
function Scanner(props: { readonly onCode: (code: string) => void; readonly onClose: () => void }) {
  const { t } = useTranslation();
  const video = useRef<HTMLVideoElement>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const hasDetector = detectorClass() !== undefined;
  const onCode = useRef(props.onCode);

  useEffect(() => {
    onCode.current = props.onCode;
  });

  // The camera is a system outside React: it is opened with the dialog and closed with it.
  useEffect(() => {
    const Found = detectorClass();
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setInterval> | undefined;

    if (Found === undefined) {
      return;
    }

    const detector = new Found({ formats: ['qr_code'] });

    void navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'environment' } })
      .then((opened) => {
        stream = opened;

        if (video.current !== null) {
          video.current.srcObject = opened;
          void video.current.play();
        }

        timer = setInterval(() => {
          if (video.current === null || video.current.readyState < 2) {
            return;
          }

          void detector
            .detect(video.current)
            .then((codes) => {
              const matter = codes.find((each) => /^MT:/iu.test(each.rawValue));

              if (matter !== undefined) {
                onCode.current(matter.rawValue);
              }
            })
            .catch(() => undefined);
        }, SCAN_MS);
      })
      .catch(() => {
        setProblem(t('brokers.matter.scan.noCamera', 'The browser gave no camera.'));
      });

    return () => {
      clearInterval(timer);

      for (const track of stream?.getTracks() ?? []) {
        track.stop();
      }
    };
  }, [t]);

  return (
    <Modal
      isOpen
      onClose={props.onClose}
      size="medium"
      layout="card"
      title={t('brokers.matter.scan.title', 'Scan the QR code')}
      description={t('brokers.matter.scan.line', 'On the device or its box')}
      footer={
        <>
          <span />
          <Button variant="bare" onClick={props.onClose}>
            {t('common.cancel', 'Cancel')}
          </Button>
        </>
      }
    >
      {!hasDetector ? (
        <Note tone="warning">
          {t(
            'brokers.matter.scan.noDetector',
            'This browser cannot read QR codes: type the code instead.',
          )}
        </Note>
      ) : problem === null ? (
        <video
          ref={video}
          muted
          playsInline
          className="aspect-square w-full rounded-inner border border-border bg-rail object-cover"
        />
      ) : (
        <Note tone="warning">{problem}</Note>
      )}
    </Modal>
  );
}
