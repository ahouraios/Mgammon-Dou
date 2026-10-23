import React, { useEffect, useRef, useState } from 'react';
import { Camera, X, RefreshCw, Check, Image as ImageIcon } from 'lucide-react';

interface CameraCaptureModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCapture: (fileName: string, base64Data: string, mimeType: string) => void;
  title?: string;
}

export const CameraCaptureModal: React.FC<CameraCaptureModalProps> = ({
  isOpen,
  onClose,
  onCapture,
  title = 'ثبت تصویر با دوربین موبایل',
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fallbackInputRef = useRef<HTMLInputElement | null>(null);

  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [capturedBase64, setCapturedBase64] = useState<string | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  };

  const startCamera = async (mode: 'environment' | 'user') => {
    stopCamera();
    setCameraError(null);
    setStarting(true);
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setCameraError('مرورگر شما از پیش‌نمایش زنده دوربین پشتیبانی نمی‌کند. از دکمه زیر برای باز کردن دوربین گوشی استفاده کنید.');
        return;
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: mode },
          width: { ideal: 1280 },
          height: { ideal: 960 },
        },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }
    } catch {
      setCameraError(
        'دسترسی مستقیم به دوربین مسدود است یا در این دستگاه نیاز به انتخاب از دوربین گوشی دارد. روی دکمه «باز کردن دوربین / گالری گوشی» بزنید.'
      );
    } finally {
      setStarting(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      setCapturedBase64(null);
      startCamera(facingMode);
    } else {
      stopCamera();
    }
    return () => {
      stopCamera();
    };
  }, [isOpen, facingMode]);

  if (!isOpen) return null;

  const handleTakeSnapshot = () => {
    if (!videoRef.current) return;
    const video = videoRef.current;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 960;
    canvas.height = video.videoHeight || 720;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
    setCapturedBase64(dataUrl);
    stopCamera();
  };

  const handleConfirm = () => {
    if (!capturedBase64) return;
    const fileName = `camera_${Date.now()}.jpg`;
    onCapture(fileName, capturedBase64, 'image/jpeg');
    onClose();
  };

  const handleFallbackFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        onCapture(file.name || `photo_${Date.now()}.jpg`, reader.result, file.type || 'image/jpeg');
        onClose();
      }
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-[#0B192C]/85 backdrop-blur-sm flex items-center justify-center p-3"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-3xl border border-[#C5A059] w-full max-w-md overflow-hidden shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="bg-[#0B192C] text-white px-4 py-3 flex items-center justify-between border-b border-[#C5A059]/40">
          <div className="flex items-center gap-2">
            <Camera className="w-4 h-4 text-[#C5A059]" />
            <span className="text-xs font-bold">{title}</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-xl bg-white/10 hover:bg-white/20 text-white cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 space-y-3">
          {capturedBase64 ? (
            <div className="space-y-3">
              <img
                src={capturedBase64}
                alt="تصویر ثبت‌شده"
                className="w-full max-h-[340px] object-contain rounded-2xl bg-slate-950"
              />
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setCapturedBase64(null);
                    startCamera(facingMode);
                  }}
                  className="min-h-[42px] rounded-xl border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-100 flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>برداشت مجدد</span>
                </button>
                <button
                  type="button"
                  onClick={handleConfirm}
                  className="min-h-[42px] rounded-xl bg-[#0B192C] text-[#C5A059] border border-[#C5A059] text-xs font-bold hover:bg-[#142844] flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <Check className="w-4 h-4" />
                  <span>استفاده از این عکس</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {!cameraError ? (
                <div className="relative rounded-2xl overflow-hidden bg-slate-950 aspect-[4/3] flex items-center justify-center">
                  <video
                    ref={videoRef}
                    playsInline
                    muted
                    autoPlay
                    className="w-full h-full object-cover"
                  />
                  {starting && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/50 text-white text-xs">
                      در حال آماده‌سازی دوربین...
                    </div>
                  )}
                </div>
              ) : (
                <div className="rounded-2xl bg-amber-50 border border-amber-200 p-4 text-xs text-amber-900 leading-relaxed text-center">
                  {cameraError}
                </div>
              )}

              {!cameraError && (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      setFacingMode((m) => (m === 'environment' ? 'user' : 'environment'))
                    }
                    className="min-h-[42px] px-3 rounded-xl border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-100 flex items-center gap-1.5 cursor-pointer"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>تغییر دوربین</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleTakeSnapshot}
                    className="flex-1 min-h-[42px] rounded-xl bg-[#0B192C] text-[#C5A059] border border-[#C5A059] text-xs font-bold hover:bg-[#142844] flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <Camera className="w-4 h-4" />
                    <span>ثبت عکس</span>
                  </button>
                </div>
              )}

              <div className="pt-2 border-t border-slate-100">
                <input
                  ref={fallbackInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={handleFallbackFile}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => fallbackInputRef.current?.click()}
                  className="w-full min-h-[40px] rounded-xl bg-[#FCF9F2] border border-[#C5A059]/60 text-xs font-semibold text-[#0B192C] hover:border-[#C5A059] flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <ImageIcon className="w-4 h-4 text-[#9A7428]" />
                  <span>باز کردن دوربین / انتخاب از گالری گوشی</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
