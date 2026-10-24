import React, { useState } from 'react';
import { X, Download, ZoomIn, ZoomOut, FileText, Image as ImageIcon, Film, Volume2 } from 'lucide-react';
import { toPersianDigits } from '../shared/jalali';
import { withAuthTokenUrl } from '../services/api';

export interface PreviewFileItem {
  file_name: string;
  file_url: string;
  mime_type?: string;
  file_size?: number;
}

interface FilePreviewModalProps {
  file: PreviewFileItem | null;
  onClose: () => void;
}

export const FilePreviewModal: React.FC<FilePreviewModalProps> = ({ file, onClose }) => {
  const [zoom, setZoom] = useState(1);

  if (!file) return null;

  const authenticatedUrl = withAuthTokenUrl(file.file_url);
  const lowerName = (file.file_name || file.file_url || '').toLowerCase();
  const mime = (file.mime_type || '').toLowerCase();

  const isImage =
    mime.startsWith('image/') ||
    /\.(jpg|jpeg|png|webp|gif|svg|bmp)$/i.test(lowerName);
  const isPdf = mime === 'application/pdf' || lowerName.endsWith('.pdf');
  const isAudio =
    mime.startsWith('audio/') ||
    /\.(webm|mp3|wav|ogg|m4a)$/i.test(lowerName);
  const isVideo =
    mime.startsWith('video/') ||
    /\.(mp4|mov)$/i.test(lowerName);

  const formatFileSize = (bytes?: number) => {
    if (!bytes) return '';
    if (bytes < 1024) return `${toPersianDigits(bytes)} بایت`;
    if (bytes < 1024 * 1024) return `${toPersianDigits((bytes / 1024).toFixed(1))} کیلوبایت`;
    return `${toPersianDigits((bytes / (1024 * 1024)).toFixed(2))} مگابایت`;
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-[#0B192C]/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-6"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-3xl border border-[#C5A059] w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* هدر پاپ‌آپ پیش‌نمایش */}
        <div className="bg-[#0B192C] text-white px-4 py-3 flex items-center justify-between gap-2 border-b border-[#C5A059]/40">
          <div className="flex items-center gap-2 min-w-0">
            {isImage ? (
              <ImageIcon className="w-4 h-4 text-[#C5A059] shrink-0" />
            ) : isAudio ? (
              <Volume2 className="w-4 h-4 text-[#C5A059] shrink-0" />
            ) : isVideo ? (
              <Film className="w-4 h-4 text-[#C5A059] shrink-0" />
            ) : (
              <FileText className="w-4 h-4 text-[#C5A059] shrink-0" />
            )}
            <div className="min-w-0">
              <div className="text-xs font-bold truncate" dir="ltr">
                {file.file_name || 'پیش‌نمایش فایل'}
              </div>
              {file.file_size ? (
                <div className="text-[10px] text-[#C5A059]">
                  حجم فایل: {formatFileSize(file.file_size)}
                </div>
              ) : null}
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {isImage && (
              <>
                <button
                  type="button"
                  onClick={() => setZoom((z) => Math.min(2.5, Number((z + 0.25).toFixed(2))))}
                  title="بزرگ‌نمایی"
                  className="p-2 rounded-xl bg-white/10 hover:bg-white/20 text-white transition-colors cursor-pointer"
                >
                  <ZoomIn className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setZoom((z) => Math.max(0.5, Number((z - 0.25).toFixed(2))))}
                  title="کوچک‌نمایی"
                  className="p-2 rounded-xl bg-white/10 hover:bg-white/20 text-white transition-colors cursor-pointer"
                >
                  <ZoomOut className="w-4 h-4" />
                </button>
              </>
            )}
            <button
              type="button"
              onClick={onClose}
              title="بستن پیش‌نمایش"
              className="p-2 rounded-xl bg-white/10 hover:bg-red-500/80 text-white transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* بدنه پیش‌نمایش */}
        <div className="flex-1 overflow-auto bg-slate-900/5 p-4 flex items-center justify-center min-h-[260px]">
          {isImage ? (
            <div className="overflow-auto max-h-[65vh] flex items-center justify-center">
              <img
                src={authenticatedUrl}
                alt={file.file_name}
                style={{ transform: `scale(${zoom})`, transformOrigin: 'center center' }}
                className="max-w-full max-h-[62vh] object-contain rounded-xl transition-transform duration-200"
              />
            </div>
          ) : isPdf ? (
            <iframe
              src={authenticatedUrl}
              title={file.file_name}
              className="w-full h-[65vh] rounded-xl border border-slate-200 bg-white"
            />
          ) : isAudio ? (
            <div className="w-full max-w-md bg-white rounded-2xl border border-[#C5A059]/50 p-6 text-center space-y-4">
              <Volume2 className="w-10 h-10 text-[#C5A059] mx-auto" />
              <div className="text-xs font-bold text-[#0B192C]" dir="ltr">
                {file.file_name}
              </div>
              <audio controls src={authenticatedUrl} className="w-full" />
            </div>
          ) : isVideo ? (
            <video
              controls
              src={authenticatedUrl}
              className="max-w-full max-h-[62vh] rounded-xl bg-black"
            />
          ) : (
            <div className="bg-white rounded-2xl border border-slate-200 p-6 text-center max-w-sm w-full space-y-3">
              <FileText className="w-12 h-12 text-[#C5A059] mx-auto" />
              <div className="text-sm font-bold text-[#0B192C] break-all" dir="ltr">
                {file.file_name}
              </div>
              {file.file_size ? (
                <div className="text-xs text-slate-500">
                  حجم: {formatFileSize(file.file_size)}
                </div>
              ) : null}
              <p className="text-xs text-slate-600 leading-relaxed">
                این نوع فایل قابل نمایش مستقیم در مرورگر نیست؛ در صورت نیاز می‌توانید آن را دانلود کنید.
              </p>
            </div>
          )}
        </div>

        {/* فوتر با دکمه دانلود اختیاری */}
        <div className="bg-white border-t border-slate-200 px-4 py-3 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={onClose}
            className="min-h-[40px] px-4 rounded-xl border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
          >
            بستن
          </button>

          <a
            href={authenticatedUrl}
            download={file.file_name || true}
            target="_blank"
            rel="noopener noreferrer"
            className="min-h-[40px] px-4 rounded-xl bg-[#0B192C] text-[#C5A059] border border-[#C5A059] text-xs font-bold hover:bg-[#142844] flex items-center gap-2 transition-colors"
          >
            <Download className="w-4 h-4" />
            <span>دانلود فایل</span>
          </a>
        </div>
      </div>
    </div>
  );
};
