import React, { useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';
import { Camera, ImageUp, Link2, Loader2, QrCode, X } from 'lucide-react';

interface QrInviteScannerModalProps {
  onClose: () => void;
  onTokenDetected: (token: string) => void;
}

export function extractInviteTokenFromInput(rawInput: string): string | null {
  const trimmed = rawInput.trim();
  if (!trimmed) return null;

  try {
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
      const url = new URL(trimmed);
      const qToken = url.searchParams.get('invite');
      if (qToken && /^[a-zA-Z0-9_-]{8,128}$/.test(qToken.trim())) {
        return qToken.trim();
      }
      const pathMatch = url.pathname.match(/\/invite\/([a-zA-Z0-9_-]{8,128})/);
      if (pathMatch) return pathMatch[1];
    }
  } catch {
    // Fall back to regex/raw parsing
  }

  const queryMatch = trimmed.match(/[?&]invite=([a-zA-Z0-9_-]{8,128})/);
  if (queryMatch) return queryMatch[1];

  const pathMatch = trimmed.match(/\/invite\/([a-zA-Z0-9_-]{8,128})/);
  if (pathMatch) return pathMatch[1];

  if (/^[a-zA-Z0-9_-]{12,128}$/.test(trimmed)) {
    return trimmed;
  }

  return null;
}

export const QrInviteScannerModal: React.FC<QrInviteScannerModalProps> = ({ onClose, onTokenDetected }) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number>(0);
  const onTokenDetectedRef = useRef(onTokenDetected);
  onTokenDetectedRef.current = onTokenDetected;

  const [mode, setMode] = useState<'camera' | 'upload' | 'paste'>('camera');
  const [cameraState, setCameraState] = useState<'starting' | 'scanning' | 'error'>('starting');
  const [retryCount, setRetryCount] = useState(0);
  const [errorMsg, setErrorMsg] = useState('');
  const [manualInput, setManualInput] = useState('');
  const [uploading, setUploading] = useState(false);

  const stopCamera = () => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
  };

  useEffect(() => {
    if (mode !== 'camera') {
      stopCamera();
      return;
    }

    let cancelled = false;
    setCameraState('starting');
    setErrorMsg('');

    const startCamera = async () => {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setCameraState('error');
        setErrorMsg(
          'Live camera access requires HTTPS or a supported browser. Switch to QR Image to scan a saved screenshot, or Paste Link to open an invitation URL.'
        );
        return;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false,
        });

        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        streamRef.current = stream;
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play();

        if (cancelled) return;
        setCameraState('scanning');

        const BarcodeDetectorCtor = (
          window as unknown as {
            BarcodeDetector?: new (opts?: { formats?: string[] }) => {
              detect: (source: HTMLVideoElement | HTMLCanvasElement) => Promise<Array<{ rawValue?: string }>>;
            };
          }
        ).BarcodeDetector;
        const nativeDetector = BarcodeDetectorCtor ? new BarcodeDetectorCtor({ formats: ['qr_code'] }) : null;

        let lastScanAt = 0;
        const scanFrame = async (now: number) => {
          if (cancelled) return;
          if (video.readyState >= 2 && now - lastScanAt > 160) {
            lastScanAt = now;
            try {
              if (nativeDetector) {
                const hits = await nativeDetector.detect(video);
                for (const hit of hits) {
                  const token = hit.rawValue ? extractInviteTokenFromInput(hit.rawValue) : null;
                  if (token) {
                    stopCamera();
                    onTokenDetectedRef.current(token);
                    return;
                  }
                }
              }

              const canvas = canvasRef.current;
              if (canvas && video.videoWidth > 0 && video.videoHeight > 0) {
                const targetW = Math.min(720, video.videoWidth);
                const targetH = Math.round((video.videoHeight / video.videoWidth) * targetW);
                canvas.width = targetW;
                canvas.height = targetH;
                const ctx = canvas.getContext('2d', { willReadFrequently: true });
                if (ctx) {
                  ctx.drawImage(video, 0, 0, targetW, targetH);
                  const imageData = ctx.getImageData(0, 0, targetW, targetH);
                  const decoded = jsQR(imageData.data, targetW, targetH, { inversionAttempts: 'attemptBoth' });
                  if (decoded?.data) {
                    const token = extractInviteTokenFromInput(decoded.data);
                    if (token) {
                      stopCamera();
                      onTokenDetectedRef.current(token);
                      return;
                    }
                  }
                }
              }
            } catch {
              // Continue scanning next frame
            }
          }
          rafRef.current = requestAnimationFrame(scanFrame);
        };

        rafRef.current = requestAnimationFrame(scanFrame);
      } catch (err) {
        if (cancelled) return;
        setCameraState('error');
        const name = err instanceof DOMException ? err.name : '';
        if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
          setErrorMsg(
            'Camera permission was denied. Click the camera/lock icon in your browser address bar to allow camera access, then tap Retry Camera — or use QR Image / Paste Link.'
          );
        } else if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
          setErrorMsg('No camera was detected on this device. Upload a saved QR screenshot or paste the invitation link instead.');
        } else {
          setErrorMsg(
            'Unable to start the camera preview here. Tap Retry Camera, upload a QR Image, or paste the invitation link.'
          );
        }
      }
    };

    startCamera();

    return () => {
      cancelled = true;
      stopCamera();
    };
  }, [mode, retryCount]);

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setErrorMsg('');
    setUploading(true);

    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const maxDim = 1024;
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          setUploading(false);
          setErrorMsg('Unable to process this image.');
          return;
        }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const decoded = jsQR(imageData.data, canvas.width, canvas.height, { inversionAttempts: 'attemptBoth' });
        setUploading(false);

        if (!decoded?.data) {
          setErrorMsg('No valid QR code found in this image. Ensure the QR code is crisp and clearly visible.');
          return;
        }
        const token = extractInviteTokenFromInput(decoded.data);
        if (!token) {
          setErrorMsg('This QR code does not contain a valid SettleUp group invitation link.');
          return;
        }
        onTokenDetected(token);
      };
      img.onerror = () => {
        setUploading(false);
        setErrorMsg('Could not read the selected image file.');
      };
      if (typeof reader.result === 'string') {
        img.src = reader.result;
      }
    };
    reader.onerror = () => {
      setUploading(false);
      setErrorMsg('Unable to read this file.');
    };
    reader.readAsDataURL(file);
  };

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    const token = extractInviteTokenFromInput(manualInput);
    if (!token) {
      setErrorMsg('Please paste a valid SettleUp invite URL (e.g. .../?invite=...) or invitation token.');
      return;
    }
    onTokenDetected(token);
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/55 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Scan Group Invitation QR Code"
    >
      <div className="bg-white border border-slate-200 rounded-2xl max-w-md w-full p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <QrCode className="w-5 h-5 text-[#065F46]" />
            <h2 className="font-display text-lg font-bold text-slate-900">Join Group via QR or Link</h2>
          </div>
          <button
            type="button"
            onClick={() => {
              stopCamera();
              onClose();
            }}
            aria-label="Close QR scanner"
            className="text-slate-400 hover:text-slate-700 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="grid grid-cols-3 gap-1 p-1 bg-slate-100 rounded-lg text-xs font-semibold">
          <button
            type="button"
            onClick={() => {
              setErrorMsg('');
              setMode('camera');
            }}
            className={`py-2 rounded-md inline-flex items-center justify-center gap-1.5 cursor-pointer ${
              mode === 'camera' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
            }`}
          >
            <Camera className="w-3.5 h-3.5" /> Camera
          </button>
          <button
            type="button"
            onClick={() => {
              setErrorMsg('');
              setMode('upload');
            }}
            className={`py-2 rounded-md inline-flex items-center justify-center gap-1.5 cursor-pointer ${
              mode === 'upload' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
            }`}
          >
            <ImageUp className="w-3.5 h-3.5" /> QR Image
          </button>
          <button
            type="button"
            onClick={() => {
              setErrorMsg('');
              setMode('paste');
            }}
            className={`py-2 rounded-md inline-flex items-center justify-center gap-1.5 cursor-pointer ${
              mode === 'paste' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
            }`}
          >
            <Link2 className="w-3.5 h-3.5" /> Paste Link
          </button>
        </div>

        {errorMsg && (
          <div role="alert" className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-900 leading-relaxed">
            {errorMsg}
          </div>
        )}

        {mode === 'camera' && (
          <div className="space-y-3">
            <div className="relative rounded-xl overflow-hidden bg-slate-900 aspect-[4/3] flex items-center justify-center border border-slate-200">
              <video ref={videoRef} playsInline muted className="w-full h-full object-cover" />
              <canvas ref={canvasRef} className="hidden" />
              {cameraState === 'starting' && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-900/80 text-white text-xs gap-2">
                  <Loader2 className="w-5 h-5 animate-spin" />
                  <span>Starting camera...</span>
                </div>
              )}
              {cameraState === 'scanning' && (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                  <div className="w-44 h-44 border-2 border-emerald-400 rounded-xl shadow-[0_0_0_9999px_rgba(15,23,42,0.35)]" />
                </div>
              )}
              {cameraState === 'error' && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-900/90 text-white p-4 text-center gap-3">
                  <Camera className="w-7 h-7 text-amber-400" />
                  <p className="text-xs text-slate-200 max-w-xs">
                    Camera is currently unavailable or permission is blocked.
                  </p>
                  <div className="flex flex-wrap items-center justify-center gap-2">
                    <button
                      type="button"
                      onClick={() => setRetryCount((c) => c + 1)}
                      className="px-3 py-1.5 text-xs font-semibold bg-[#065F46] hover:bg-[#047857] text-white rounded-lg cursor-pointer"
                    >
                      Retry Camera
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setErrorMsg('');
                        setMode('upload');
                      }}
                      className="px-3 py-1.5 text-xs font-semibold bg-white text-slate-900 rounded-lg cursor-pointer"
                    >
                      Upload QR Image
                    </button>
                  </div>
                </div>
              )}
            </div>
            <p className="text-xs text-slate-500 text-center">
              Point your camera at a SettleUp group invitation QR code, or switch to QR Image / Paste Link.
            </p>
          </div>
        )}

        {mode === 'upload' && (
          <div className="space-y-3">
            <label className="border-2 border-dashed border-slate-300 hover:border-[#065F46] rounded-xl p-8 flex flex-col items-center justify-center gap-2 text-center cursor-pointer transition-colors">
              {uploading ? (
                <Loader2 className="w-6 h-6 animate-spin text-[#065F46]" />
              ) : (
                <ImageUp className="w-7 h-7 text-[#065F46]" />
              )}
              <span className="text-sm font-semibold text-slate-900">
                {uploading ? 'Decoding QR image...' : 'Upload QR Code Screenshot or PNG'}
              </span>
              <span className="text-xs text-slate-500">Supports PNG, JPG, and WebP images</span>
              <input type="file" accept="image/*" onChange={handleImageUpload} className="sr-only" />
            </label>
          </div>
        )}

        {mode === 'paste' && (
          <form onSubmit={handleManualSubmit} className="space-y-3">
            <div>
              <label htmlFor="manual-invite-input" className="block text-xs font-medium text-slate-700 mb-1">
                Invitation Link or Token
              </label>
              <input
                id="manual-invite-input"
                type="text"
                value={manualInput}
                onChange={(e) => setManualInput(e.target.value)}
                placeholder="Paste invitation URL or token"
                className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg focus:border-[#065F46] focus:outline-none"
                required
              />
            </div>
            <button
              type="submit"
              className="w-full py-2.5 text-sm font-semibold text-white bg-[#065F46] hover:bg-[#047857] rounded-lg cursor-pointer"
            >
              Verify Invitation
            </button>
          </form>
        )}
      </div>
    </div>
  );
};
