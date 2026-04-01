import { useEffect, useMemo, useRef, useState } from 'react';
import { BrowserQRCodeReader, type IScannerControls } from '@zxing/browser';

type Props = {
  open: boolean;
  busy?: boolean;
  onClose: () => void;
  onSubmit: (input: { token: string; pin: string }) => Promise<void> | void;
};

function readEnrollmentToken(raw: string): string | null {
  const normalized = raw.trim();
  if (!normalized) {
    return null;
  }

  try {
    const decoded = decodeURIComponent(normalized);
    const directMatch = decoded.match(/[?&](?:token|setup_token)=([^&]+)/i);
    if (directMatch?.[1]) {
      return directMatch[1];
    }
    const pathMatch = decoded.match(/\/enroll\/([^/?#]+)/i);
    if (pathMatch?.[1]) {
      return pathMatch[1];
    }
    const tokenLike = decoded.match(/^[A-Za-z0-9._~-]{24,}$/);
    if (tokenLike) {
      return decoded;
    }
  } catch {
    return null;
  }

  return null;
}

function friendlyDecodeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? '');
  if (!message.trim()) {
    return 'Unable to scan that QR code.';
  }
  if (/notfoundexception/i.test(message)) {
    return 'No setup QR was found. Try another image or hold the QR more clearly in front of the camera.';
  }
  if (/notallowederror|permission/i.test(message)) {
    return 'Camera permission was blocked. Allow camera access or use image upload or paste instead.';
  }
  if (/notreadableerror|trackstarterror/i.test(message)) {
    return 'This workstation camera could not be opened. Another app may be using it.';
  }
  return message;
}

export function QuickSetupQrModal({ open, busy = false, onClose, onSubmit }: Props): JSX.Element | null {
  const [manualValue, setManualValue] = useState('');
  const [pin, setPin] = useState('');
  const [message, setMessage] = useState('Use camera, upload a QR image, or paste the setup link/token.');
  const [cameraBusy, setCameraBusy] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const controlsRef = useRef<IScannerControls | null>(null);
  const readerRef = useRef<BrowserQRCodeReader | null>(null);

  const canManualSubmit = useMemo(() => manualValue.trim().length > 0 && !busy, [manualValue, busy]);

  useEffect(() => {
    if (!open) {
      setManualValue('');
      setPin('');
      setMessage('Use camera, upload a QR image, or paste the setup link/token.');
      setCameraReady(false);
      stopCamera();
    }
    return () => {
      stopCamera();
    };
  }, [open]);

  function ensureReader(): BrowserQRCodeReader {
    if (!readerRef.current) {
      readerRef.current = new BrowserQRCodeReader();
    }
    return readerRef.current;
  }

  function stopCamera(): void {
    try {
      controlsRef.current?.stop();
    } catch {
      // Ignore stop failures during modal teardown.
    }
    controlsRef.current = null;
    if (videoRef.current) {
      BrowserQRCodeReader.cleanVideoSource(videoRef.current);
    }
    setCameraReady(false);
  }

  const trySubmitPayload = async (payload: string): Promise<void> => {
    const token = readEnrollmentToken(payload);
    if (!token) {
      setMessage('That QR or text does not contain a valid setup token.');
      return;
    }
    setMessage('Setup token detected. Finishing quick setup...');
    await onSubmit({ token, pin });
  };

  const startCamera = async (): Promise<void> => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setMessage('Camera access is not available on this workstation. Use image upload or paste the token.');
      return;
    }
    if (!videoRef.current) {
      setMessage('Camera preview is not ready yet. Please retry.');
      return;
    }

    stopCamera();
    setCameraBusy(true);
    setMessage('Starting camera...');
    try {
      const reader = ensureReader();
      const devices = await BrowserQRCodeReader.listVideoInputDevices().catch(() => []);
      const preferredDevice =
        devices.find((device) => /back|rear|environment/i.test(device.label)) ??
        devices[0] ??
        undefined;

      controlsRef.current = await reader.decodeFromVideoDevice(
        preferredDevice?.deviceId,
        videoRef.current,
        (result, _error, controls) => {
          if (!result) {
            return;
          }
          controls.stop();
          controlsRef.current = null;
          setCameraReady(false);
          void trySubmitPayload(result.getText());
        }
      );

      setCameraReady(true);
      setMessage('Point the camera at the setup QR.');
    } catch (error) {
      stopCamera();
      setMessage(friendlyDecodeError(error));
    } finally {
      setCameraBusy(false);
    }
  };

  const handleUpload = async (file: File | null): Promise<void> => {
    if (!file) {
      return;
    }
    setMessage('Reading QR image...');
    try {
      const reader = ensureReader();
      const imageUrl = URL.createObjectURL(file);
      try {
        const result = await reader.decodeFromImageUrl(imageUrl);
        await trySubmitPayload(result.getText());
      } finally {
        URL.revokeObjectURL(imageUrl);
      }
    } catch (error) {
      setMessage(friendlyDecodeError(error));
    }
  };

  if (!open) {
    return null;
  }

  return (
    <div className="desktop-modal-backdrop" role="presentation">
      <section className="desktop-modal-card startup-qr-modal">
        <div className="panel-head">
          <div>
            <div className="eyebrow">Quick setup</div>
            <h3>Scan or upload the setup QR</h3>
            <p>Same shortcut as mobile: claim setup token, sign in the cashier, then download branch data.</p>
          </div>
          <button className="secondary-btn mini-btn" type="button" onClick={onClose} disabled={busy}>
            Close
          </button>
        </div>

        <div className="startup-qr-grid">
          <div className="startup-camera-panel">
            <video ref={videoRef} className="startup-camera-preview" muted playsInline />
            <div className="startup-camera-actions">
              <button className="secondary-btn mini-btn" type="button" onClick={() => void startCamera()} disabled={busy || cameraBusy}>
                {cameraBusy ? 'Starting Camera...' : cameraReady ? 'Camera Running' : 'Use Camera'}
              </button>
              {cameraReady ? (
                <button className="secondary-btn mini-btn" type="button" onClick={stopCamera} disabled={busy}>
                  Stop Camera
                </button>
              ) : null}
            </div>
          </div>

          <div className="startup-upload-panel">
            <label className="full-width-field">
              <span>Upload QR image</span>
              <input
                type="file"
                accept="image/*"
                onChange={(event) => {
                  const file = event.target.files?.[0] ?? null;
                  void handleUpload(file);
                  event.currentTarget.value = '';
                }}
                disabled={busy}
              />
            </label>
            <label className="full-width-field">
              <span>Paste setup link or token</span>
              <textarea
                value={manualValue}
                onChange={(event) => setManualValue(event.target.value)}
                placeholder="vpos://enroll?token=..."
                rows={4}
                disabled={busy}
              />
            </label>
            <label className="full-width-field">
              <span>PIN for quick unlock later (optional)</span>
              <input
                type="password"
                value={pin}
                onChange={(event) => setPin(event.target.value)}
                placeholder="4 to 8 digits"
                inputMode="numeric"
                disabled={busy}
              />
            </label>
            <div className="startup-camera-actions">
              <button className="primary-btn mini-btn" type="button" onClick={() => void trySubmitPayload(manualValue)} disabled={!canManualSubmit}>
                {busy ? 'Finishing Setup...' : 'Use This Token'}
              </button>
            </div>
          </div>
        </div>

        <div className="message-banner">{message}</div>
      </section>
    </div>
  );
}
