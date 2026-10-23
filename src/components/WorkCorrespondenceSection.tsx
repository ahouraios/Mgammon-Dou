import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Send,
  Paperclip,
  Camera,
  Reply,
  CheckCheck,
  Clock,
  Search,
  Eye,
  Download,
  Smartphone,
  X,
  FileText,
  Mic,
  Square,
  Trash2,
  Volume2,
} from 'lucide-react';
import { DeliveryChannel, UserRole, WorkCorrespondence } from '../shared/types';
import { apiRequest } from '../services/api';
import { pad2, toPersianDigits } from '../shared/jalali';
import { ShamsiDatePicker } from './ShamsiDatePicker';
import { FilePreviewModal, PreviewFileItem } from './FilePreviewModal';
import { CameraCaptureModal } from './CameraCaptureModal';

interface WorkCorrespondenceSectionProps {
  role?: UserRole;
  currentUserRole?: UserRole;
  todayShamsi: string;
  onUnreadChange?: (unreadCount: number) => void;
  onUnreadCleared?: () => void;
}

interface PendingUploadFile {
  file_name: string;
  file_base64: string;
  mime_type: string;
  size: number;
}

type MediaQuickFilter = 'ALL' | 'VOICE' | 'FILES';

function getSupportedAudioMimeType(): string {
  if (typeof MediaRecorder === 'undefined') return '';
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/ogg;codecs=opus',
    'audio/aac',
  ];
  for (const mime of candidates) {
    try {
      if (MediaRecorder.isTypeSupported(mime)) {
        return mime;
      }
    } catch {
      // ignore
    }
  }
  return '';
}

export const WorkCorrespondenceSection: React.FC<WorkCorrespondenceSectionProps> = ({
  role,
  currentUserRole,
  todayShamsi,
  onUnreadChange,
  onUnreadCleared,
}) => {
  const effectiveRole: UserRole = role || currentUserRole || 'worker';

  const [items, setItems] = useState<WorkCorrespondence[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(
    null
  );

  // فرم ارسال پیام، صدا و فایل
  const [subject, setSubject] = useState('');
  const [messageText, setMessageText] = useState('');
  const [replyTo, setReplyTo] = useState<WorkCorrespondence | null>(null);
  const [deliveryChannel, setDeliveryChannel] = useState<DeliveryChannel>('IN_APP');
  const [selectedFiles, setSelectedFiles] = useState<PendingUploadFile[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // دوربین موبایل و پیش‌نمایش پاپ‌آپ فایل‌ها
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const [previewFile, setPreviewFile] = useState<PreviewFileItem | null>(null);

  // ضبط صدا (Voice Recorder) برای هر دو کاربر
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [recordedAudioBase64, setRecordedAudioBase64] = useState<string | null>(null);
  const [recordedAudioMime, setRecordedAudioMime] = useState<string>('audio/webm');
  const [recordedDuration, setRecordedDuration] = useState<number>(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordTimerRef = useRef<number | null>(null);

  // فیلترها و جست‌وجو
  const [search, setSearch] = useState('');
  const [senderFilter, setSenderFilter] = useState('');
  const [fromShamsi, setFromShamsi] = useState('');
  const [toShamsi, setToShamsi] = useState('');
  const [mediaFilter, setMediaFilter] = useState<MediaQuickFilter>('ALL');

  const loadCorrespondences = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (search.trim()) params.set('search', search.trim());
      if (senderFilter) params.set('senderRole', senderFilter);
      if (fromShamsi.trim()) params.set('fromShamsi', fromShamsi.trim());
      if (toShamsi.trim()) params.set('toShamsi', toShamsi.trim());

      const res = await apiRequest<{
        ok: boolean;
        correspondences: WorkCorrespondence[];
        unreadCount: number;
      }>(`/api/correspondences?${params.toString()}`);

      setItems(res.correspondences);
      setUnreadCount(res.unreadCount);
      if (onUnreadChange) {
        onUnreadChange(res.unreadCount);
      }
    } catch (err) {
      setFeedback({ type: 'error', text: (err as Error).message });
    } finally {
      setLoading(false);
    }
  }, [search, senderFilter, fromShamsi, toShamsi, onUnreadChange]);

  useEffect(() => {
    loadCorrespondences();
  }, [loadCorrespondences]);

  useEffect(() => {
    return () => {
      if (recordTimerRef.current) {
        window.clearInterval(recordTimerRef.current);
      }
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
      }
    };
  }, []);

  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      if (mediaFilter === 'VOICE') {
        return Boolean(item.audio_url);
      }
      if (mediaFilter === 'FILES') {
        return Boolean(item.attachments && item.attachments.length > 0);
      }
      return true;
    });
  }, [items, mediaFilter]);

  const composeFormRef = useRef<HTMLFormElement>(null);

  // پیام‌های جدید دریافتی که هنوز خوانده و تعیین تکلیف نشده‌اند (در بالای صفحه نمایش داده می‌شوند)
  const unreadIncomingItems = useMemo(() => {
    return items.filter((item) => !item.is_read && item.sender_role !== effectiveRole);
  }, [items, effectiveRole]);

  // پیام‌های خوانده‌شده یا ارسالی (در بخش آرشیو پایین صفحه نمایش داده می‌شوند)
  const archivedItems = useMemo(() => {
    return filteredItems.filter((item) => item.is_read || item.sender_role === effectiveRole);
  }, [filteredItems, effectiveRole]);

  const handleMarkAsRead = async (id?: number) => {
    try {
      await apiRequest('/api/correspondences/mark-read', {
        method: 'POST',
        body: JSON.stringify(id ? { id } : {}),
      });
      await loadCorrespondences();
      if (onUnreadCleared) onUnreadCleared();
    } catch {
      // ignore
    }
  };

  const startVoiceRecording = async () => {
    setFeedback(null);
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setFeedback({
        type: 'error',
        text: 'مرورگر گوشی شما از ضبط مستقیم صدا پشتیبانی نمی‌کند. می‌توانید فایل صوتی را از طریق «پیوست فایل» ارسال کنید.',
      });
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      const preferredMime = getSupportedAudioMimeType();
      const recorder = preferredMime
        ? new MediaRecorder(stream, { mimeType: preferredMime })
        : new MediaRecorder(stream);

      audioChunksRef.current = [];

      recorder.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) {
          audioChunksRef.current.push(ev.data);
        }
      };

      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        const finalMime = recorder.mimeType || preferredMime || 'audio/webm';
        setRecordedAudioMime(finalMime);
        const blob = new Blob(audioChunksRef.current, { type: finalMime });
        const reader = new FileReader();
        reader.onloadend = () => {
          if (typeof reader.result === 'string') {
            setRecordedAudioBase64(reader.result);
          }
        };
        reader.readAsDataURL(blob);
      };

      recorder.start();
      mediaRecorderRef.current = recorder;
      setIsRecording(true);
      setRecordingSeconds(0);
      setRecordedAudioBase64(null);

      recordTimerRef.current = window.setInterval(() => {
        setRecordingSeconds((prev) => {
          const next = prev + 1;
          setRecordedDuration(next);
          return next;
        });
      }, 1000);
    } catch {
      setFeedback({
        type: 'error',
        text: 'دسترسی به میکروفون مجاز نشد. لطفاً در مرورگر گوشی اجازه دسترسی به میکروفون را تأیید کنید.',
      });
    }
  };

  const stopVoiceRecording = () => {
    if (recordTimerRef.current) {
      window.clearInterval(recordTimerRef.current);
      recordTimerRef.current = null;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    setIsRecording(false);
  };

  const clearRecordedAudio = () => {
    setRecordedAudioBase64(null);
    setRecordedDuration(0);
    setRecordingSeconds(0);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;

    Array.from(fileList).forEach((file) => {
      if (file.size > 6_000_000) {
        setFeedback({
          type: 'error',
          text: `حجم فایل «${file.name}» بیش از ۶ مگابایت است.`,
        });
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === 'string') {
          setSelectedFiles((prev) => [
            ...prev.slice(0, 5),
            {
              file_name: file.name,
              file_base64: reader.result as string,
              mime_type: file.type || 'application/octet-stream',
              size: file.size,
            },
          ]);
        }
      };
      reader.readAsDataURL(file);
    });
    e.target.value = '';
  };

  const handleCameraCaptured = (fileName: string, base64Data: string, mimeType: string) => {
    setSelectedFiles((prev) => [
      ...prev.slice(0, 5),
      {
        file_name: fileName,
        file_base64: base64Data,
        mime_type: mimeType,
        size: Math.round(base64Data.length * 0.75),
      },
    ]);
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isRecording) {
      stopVoiceRecording();
      return;
    }
    setFeedback(null);
    setSending(true);
    try {
      const repliedMessage = replyTo;
      const res = await apiRequest<{ ok: boolean; message: string }>('/api/correspondences', {
        method: 'POST',
        body: JSON.stringify({
          subject: subject.trim() || undefined,
          message_text: messageText.trim(),
          parent_id: repliedMessage ? repliedMessage.id : undefined,
          delivery_channel: effectiveRole === 'manager' ? deliveryChannel : 'IN_APP',
          files: selectedFiles,
          audio_base64: recordedAudioBase64 || undefined,
          audio_mime_type: recordedAudioMime || undefined,
          audio_duration_seconds: recordedDuration || undefined,
        }),
      });
      if (repliedMessage && !repliedMessage.is_read && repliedMessage.sender_role !== effectiveRole) {
        try {
          await apiRequest('/api/correspondences/mark-read', {
            method: 'POST',
            body: JSON.stringify({ id: repliedMessage.id }),
          });
        } catch {
          // ignore
        }
      }
      setSubject('');
      setMessageText('');
      setReplyTo(null);
      setSelectedFiles([]);
      clearRecordedAudio();
      setFeedback({ type: 'success', text: res.message });
      await loadCorrespondences();
    } catch (err) {
      setFeedback({ type: 'error', text: (err as Error).message });
    } finally {
      setSending(false);
    }
  };

  const formatSec = (s: number) => {
    const mins = Math.floor(s / 60);
    const secs = s % 60;
    return toPersianDigits(`${pad2(mins)}:${pad2(secs)}`);
  };

  return (
    <div className="space-y-4">
      {feedback && (
        <div
          className={`rounded-xl border px-3.5 py-2.5 text-xs font-medium flex items-center justify-between gap-2 ${
            feedback.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-950'
              : 'bg-red-50 border-red-200 text-red-900'
          }`}
        >
          <span>{feedback.text}</span>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            className="text-xs underline cursor-pointer"
          >
            بستن
          </button>
        </div>
      )}

      {/* ================= بخش ۱ (بالای صفحه): پیام‌های جدید دریافتی و تعیین تکلیف آن‌ها ================= */}
      <div className="rounded-2xl bg-gradient-to-b from-[#FCF9F2] to-white border-2 border-[#C5A059] p-4 space-y-3 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#C5A059]/30 pb-2.5">
          <div className="flex items-center gap-2">
            <span
              className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                unreadIncomingItems.length > 0
                  ? 'bg-[#C5A059] animate-ping'
                  : 'bg-emerald-500'
              }`}
            />
            <div>
              <h3 className="text-xs sm:text-sm font-extrabold text-[#0B192C]">
                {unreadIncomingItems.length > 0
                  ? `پیام‌های جدید دریافتی (${toPersianDigits(unreadIncomingItems.length)} مورد در انتظار مشاهده و تعیین تکلیف)`
                  : 'پیام‌های جدید دریافتی'}
              </h3>
              <p className="text-[10.5px] text-slate-500 mt-0.5">
                {unreadIncomingItems.length > 0
                  ? 'ابتدا پیام‌های جدید را مطالعه و تعیین تکلیف کنید؛ پس از زدن «مشاهده شد» یا ارسال پاسخ، پیام به بخش آرشیو پایین صفحه منتقل می‌شود.'
                  : 'در حال حاضر پیام جدید خوانده‌نشده‌ای وجود ندارد. پیام‌های قبلی در بخش آرشیو پایین صفحه قرار دارند.'}
              </p>
            </div>
          </div>

          {unreadIncomingItems.length > 1 && (
            <button
              type="button"
              onClick={() => handleMarkAsRead()}
              className="min-h-[34px] px-3 rounded-xl bg-[#0B192C] hover:bg-[#162d4c] text-[#C5A059] border border-[#C5A059] font-bold text-[11px] flex items-center gap-1.5 cursor-pointer"
            >
              <CheckCheck className="w-3.5 h-3.5" />
              <span>مشاهده همه و انتقال به آرشیو</span>
            </button>
          )}
        </div>

        {loading ? (
          <p className="text-xs text-slate-500 py-3 text-center">در حال بارگذاری پیام‌های جدید...</p>
        ) : unreadIncomingItems.length === 0 ? (
          <div className="rounded-xl bg-emerald-50/70 border border-emerald-200/80 px-3 py-2.5 flex items-center gap-2 text-xs text-emerald-900">
            <CheckCheck className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>
              همه پیام‌های دریافتی تعیین تکلیف شده و در بخش آرشیو پایین صفحه قرار دارند.
            </span>
          </div>
        ) : (
          <div className="space-y-2.5">
            {unreadIncomingItems.map((msg) => {
              const defaultAvatar =
                msg.sender_role === 'manager'
                  ? '/assets/media/manager-avatar.svg'
                  : '/assets/media/worker-avatar.svg';

              return (
                <div
                  key={msg.id}
                  className="rounded-2xl bg-white border-2 border-[#C5A059] p-3.5 space-y-2.5 shadow-xs"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2.5">
                      <img
                        src={msg.sender_avatar_url || defaultAvatar}
                        alt={msg.sender_name}
                        referrerPolicy="no-referrer"
                        onError={(e) => {
                          (e.currentTarget as HTMLImageElement).src = defaultAvatar;
                        }}
                        className="w-8 h-8 rounded-xl object-cover border border-[#C5A059]"
                      />
                      <div>
                        <div className="flex flex-wrap items-center gap-1.5 text-xs">
                          <span className="px-2 py-0.5 rounded-md bg-[#0B192C] text-[#C5A059] text-[10px] font-extrabold">
                            پیام جدید
                          </span>
                          <span className="font-bold text-[#0B192C]">
                            {msg.sender_role === 'manager'
                              ? 'مدیریت: مجید نورایی'
                              : 'پرسنل: امید میثمی'}
                          </span>
                          {msg.subject && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="font-extrabold text-[#9A7428]">{msg.subject}</span>
                            </>
                          )}
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500 tabular-nums mt-0.5">
                          <span>{toPersianDigits(msg.shamsi_date)}</span>
                          <span aria-hidden="true">·</span>
                          <span>ساعت {toPersianDigits(msg.recorded_time.slice(0, 5))}</span>
                          {msg.delivery_channel !== 'IN_APP' && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="inline-flex items-center gap-1 text-emerald-700 font-medium">
                                <Smartphone className="w-3 h-3" />
                                {msg.delivery_channel === 'BOTH' ? 'داخلی + پیامک' : 'پیامک'}
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>

                    <span className="inline-flex items-center gap-1 text-[11px] text-amber-800 bg-amber-50 border border-amber-200 px-2.5 py-1 rounded-lg font-bold">
                      <Clock className="w-3 h-3" />
                      <span>در انتظار تعیین تکلیف</span>
                    </span>
                  </div>

                  {msg.parent_preview && (
                    <div className="rounded-lg bg-slate-100/80 px-2.5 py-1 text-[11px] text-slate-600">
                      پاسخ به: «{msg.parent_preview}»
                    </div>
                  )}

                  {msg.message_text && (
                    <p className="text-xs text-slate-800 leading-6 whitespace-pre-line">
                      {msg.message_text}
                    </p>
                  )}

                  {msg.audio_url && (
                    <div className="pt-1 flex items-center gap-2">
                      <audio
                        src={msg.audio_url}
                        controls
                        className="h-9 w-full max-w-xs"
                        onClick={(e) => e.stopPropagation()}
                      />
                      {msg.audio_duration_seconds && (
                        <span className="text-[11px] text-slate-500 tabular-nums">
                          {formatSec(msg.audio_duration_seconds)}
                        </span>
                      )}
                    </div>
                  )}

                  {msg.attachments && msg.attachments.length > 0 && (
                    <div className="pt-2 border-t border-slate-100 flex flex-wrap gap-2">
                      {msg.attachments.map((att, idx) => {
                        const isImg =
                          (att.mime_type || '').startsWith('image/') ||
                          /\.(jpg|jpeg|png|webp|gif|svg)$/i.test(att.file_name);
                        return (
                          <div
                            key={`${att.file_url}_${idx}`}
                            onClick={(e) => e.stopPropagation()}
                            className="rounded-xl bg-[#FCF9F2] border border-[#C5A059]/60 p-1.5 flex items-center gap-2"
                          >
                            {isImg ? (
                              <img
                                src={att.file_url}
                                alt={att.file_name}
                                onClick={() => setPreviewFile(att)}
                                className="w-10 h-10 rounded-lg object-cover border border-[#C5A059]/40 cursor-pointer"
                              />
                            ) : (
                              <FileText className="w-5 h-5 text-[#9A7428] ml-1" />
                            )}

                            <div className="min-w-0">
                              <button
                                type="button"
                                onClick={() => setPreviewFile(att)}
                                className="text-[11px] font-bold text-[#0B192C] hover:text-[#9A7428] max-w-[140px] truncate block text-right cursor-pointer"
                              >
                                {att.file_name}
                              </button>
                              <div className="flex items-center gap-2 mt-0.5">
                                <button
                                  type="button"
                                  onClick={() => setPreviewFile(att)}
                                  className="text-[10px] font-bold text-[#9A7428] hover:underline flex items-center gap-0.5 cursor-pointer"
                                >
                                  <Eye className="w-3 h-3" />
                                  <span>پیش‌نمایش</span>
                                </button>
                                <span className="text-slate-300">·</span>
                                <a
                                  href={att.file_url}
                                  download={att.file_name}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-[10px] font-semibold text-slate-600 hover:text-[#0B192C] flex items-center gap-0.5"
                                >
                                  <Download className="w-3 h-3" />
                                  <span>دانلود</span>
                                </a>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* نوار تعیین تکلیف پیام جدید (انتقال به آرشیو یا پاسخ دادن در بخش وسط صفحه) */}
                  <div className="pt-2.5 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2">
                    <span className="text-[11px] font-semibold text-slate-600">
                      تعیین تکلیف پیام:
                    </span>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setReplyTo(msg);
                          composeFormRef.current?.scrollIntoView({
                            behavior: 'smooth',
                            block: 'center',
                          });
                        }}
                        className="min-h-[34px] px-3 rounded-xl bg-[#FCF9F2] hover:bg-[#C5A059]/20 border border-[#C5A059] text-[#0B192C] text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                      >
                        <Reply className="w-3.5 h-3.5 text-[#9A7428]" />
                        <span>پاسخ به این پیام</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => handleMarkAsRead(msg.id)}
                        className="min-h-[34px] px-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold flex items-center gap-1.5 shadow-2xs cursor-pointer"
                      >
                        <CheckCheck className="w-3.5 h-3.5" />
                        <span>مشاهده شد (انتقال به آرشیو پایین)</span>
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ================= بخش ۲ (وسط صفحه): فرم ارسال پیام متنی، صوتی، عکس دوربین و فایل ================= */}
      <form
        ref={composeFormRef}
        onSubmit={handleSend}
        className="rounded-2xl bg-white border border-[#C5A059]/50 p-4 space-y-3.5"
      >
        <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
          <h3 className="text-sm font-bold text-[#0B192C]">
            {effectiveRole === 'manager'
              ? 'ارسال پیام، صدا یا فایل به پرسنل (امید میثمی)'
              : 'ارسال پیام، صدا یا فایل به مدیریت (مجید نورایی)'}
          </h3>
        </div>

        {replyTo && (
          <div className="rounded-xl bg-amber-50/80 border border-[#C5A059]/60 px-3 py-2 flex items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-1.5 min-w-0">
              <Reply className="w-3.5 h-3.5 text-[#9A7428] shrink-0" />
              <span className="font-bold text-[#0B192C] shrink-0">
                پاسخ به {replyTo.sender_name}:
              </span>
              <span className="text-slate-600 truncate">{replyTo.message_text}</span>
            </div>
            <button
              type="button"
              onClick={() => setReplyTo(null)}
              className="p-1 text-slate-500 hover:text-red-600 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              موضوع (اختیاری)
            </label>
            <input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="عنوان پیام..."
              className="w-full min-h-[42px] rounded-xl border border-slate-200 px-3 text-xs focus:outline-none focus:border-[#0B192C]"
            />
          </div>

          {effectiveRole === 'manager' && (
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                نحوه ارسال به پرسنل
              </label>
              <select
                value={deliveryChannel}
                onChange={(e) => setDeliveryChannel(e.target.value as DeliveryChannel)}
                className="w-full min-h-[42px] rounded-xl border border-[#C5A059]/60 px-3 text-xs bg-amber-50/20 font-semibold text-[#0B192C] focus:outline-none focus:border-[#0B192C]"
              >
                <option value="IN_APP">داخل برنامه</option>
                <option value="SMS">ارسال پیامک</option>
                <option value="BOTH">داخل برنامه + پیامک</option>
              </select>
            </div>
          )}
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">متن پیام</label>
          <textarea
            rows={2}
            value={messageText}
            onChange={(e) => setMessageText(e.target.value)}
            placeholder="متن پیام یا توضیحات خود را بنویسید..."
            className="w-full rounded-xl border border-slate-200 p-3 text-xs leading-6 focus:outline-none focus:border-[#0B192C]"
          />
        </div>

        {/* نوار ضبط صدا، دوربین موبایل، پیوست فایل و ارسال */}
        <div className="space-y-2.5">
          {recordedAudioBase64 && (
            <div className="rounded-xl bg-emerald-50/70 border border-emerald-200 p-2.5 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <Volume2 className="w-4 h-4 text-emerald-700 shrink-0" />
                <audio src={recordedAudioBase64} controls className="h-8 w-full max-w-xs" />
              </div>
              <button
                type="button"
                onClick={clearRecordedAudio}
                className="p-1.5 rounded-lg text-red-600 hover:bg-red-50 cursor-pointer"
                title="حذف صدای ضبط‌شده"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <input
                ref={fileInputRef}
                type="file"
                multiple
                onChange={handleFileSelect}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="min-h-[40px] px-3 rounded-xl border border-slate-200 hover:border-[#C5A059] bg-slate-50 text-xs font-semibold text-[#0B192C] flex items-center gap-1.5 cursor-pointer"
              >
                <Paperclip className="w-3.5 h-3.5 text-[#9A7428]" />
                <span>پیوست فایل</span>
              </button>

              <button
                type="button"
                onClick={() => setIsCameraOpen(true)}
                className="min-h-[40px] px-3 rounded-xl border border-slate-200 hover:border-[#C5A059] bg-slate-50 text-xs font-semibold text-[#0B192C] flex items-center gap-1.5 cursor-pointer"
              >
                <Camera className="w-3.5 h-3.5 text-[#0B192C]" />
                <span>دوربین</span>
              </button>

              {!isRecording ? (
                <button
                  type="button"
                  onClick={startVoiceRecording}
                  className="min-h-[40px] px-3 rounded-xl border border-slate-200 hover:border-[#C5A059] bg-slate-50 text-xs font-semibold text-[#0B192C] flex items-center gap-1.5 cursor-pointer"
                >
                  <Mic className="w-3.5 h-3.5 text-rose-600" />
                  <span>ضبط صدا</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={stopVoiceRecording}
                  className="min-h-[40px] px-3.5 rounded-xl bg-rose-600 text-white text-xs font-bold flex items-center gap-1.5 animate-pulse cursor-pointer"
                >
                  <Square className="w-3.5 h-3.5" />
                  <span>پایان ضبط ({formatSec(recordingSeconds)})</span>
                </button>
              )}
            </div>

            <button
              type="submit"
              disabled={sending || isRecording}
              className="w-full sm:w-auto min-h-[42px] px-5 rounded-xl bg-[#0B192C] text-[#C5A059] border border-[#C5A059] text-xs font-bold flex items-center justify-center gap-1.5 hover:bg-[#152c4a] disabled:opacity-50 cursor-pointer"
            >
              <Send className="w-3.5 h-3.5" />
              <span>{sending ? 'در حال ارسال...' : 'ارسال پیام'}</span>
            </button>
          </div>

          {selectedFiles.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {selectedFiles.map((f, idx) => (
                <div
                  key={`${f.file_name}_${idx}`}
                  className="rounded-lg bg-slate-100 border border-slate-200 px-2.5 py-1 text-xs flex items-center gap-1.5"
                >
                  <button
                    type="button"
                    onClick={() =>
                      setPreviewFile({
                        file_name: f.file_name,
                        file_url: f.file_base64,
                        mime_type: f.mime_type,
                        file_size: f.size,
                      })
                    }
                    className="flex items-center gap-1 text-[#0B192C] hover:text-[#9A7428] cursor-pointer"
                  >
                    <Eye className="w-3 h-3 text-[#9A7428]" />
                    <span className="font-medium max-w-[140px] truncate">{f.file_name}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setSelectedFiles((prev) => prev.filter((_, i) => i !== idx))
                    }
                    className="text-red-600 hover:text-red-800 cursor-pointer"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </form>

      {/* فیلتر سریع نوع محتوا + جست‌وجوی مکاتبات */}
      <div className="rounded-2xl bg-white border border-slate-200 p-3.5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2.5">
          <span className="text-xs font-bold text-[#0B192C]">فیلتر سریع مکاتبات:</span>
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-xl">
            <button
              type="button"
              onClick={() => setMediaFilter('ALL')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
                mediaFilter === 'ALL'
                  ? 'bg-[#0B192C] text-[#C5A059] shadow-sm'
                  : 'text-slate-600 hover:text-[#0B192C]'
              }`}
            >
              همه مکاتبات
            </button>
            <button
              type="button"
              onClick={() => setMediaFilter('VOICE')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
                mediaFilter === 'VOICE'
                  ? 'bg-[#0B192C] text-[#C5A059] shadow-sm'
                  : 'text-slate-600 hover:text-[#0B192C]'
              }`}
            >
              فقط پیام‌های صوتی
            </button>
            <button
              type="button"
              onClick={() => setMediaFilter('FILES')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
                mediaFilter === 'FILES'
                  ? 'bg-[#0B192C] text-[#C5A059] shadow-sm'
                  : 'text-slate-600 hover:text-[#0B192C]'
              }`}
            >
              فقط فایل‌ها و تصاویر
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5 items-end">
          <div className="col-span-2 sm:col-span-1">
            <label className="block text-xs font-medium text-slate-600 mb-1">جست‌وجو</label>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="متن، موضوع یا نام فایل..."
              className="w-full min-h-[40px] rounded-xl border border-slate-200 px-3 text-xs"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">فرستنده</label>
            <select
              value={senderFilter}
              onChange={(e) => setSenderFilter(e.target.value)}
              className="w-full min-h-[40px] rounded-xl border border-slate-200 px-2 text-xs bg-white"
            >
              <option value="">همه</option>
              <option value="manager">مدیریت (مجید نورایی)</option>
              <option value="worker">پرسنل (امید میثمی)</option>
            </select>
          </div>
          <ShamsiDatePicker
            label="از تاریخ"
            value={fromShamsi}
            onChange={setFromShamsi}
            allowClear
            placeholder="همه تاریخ‌ها"
            todayShamsi={todayShamsi}
          />
          <ShamsiDatePicker
            label="تا تاریخ"
            value={toShamsi}
            onChange={setToShamsi}
            allowClear
            placeholder="همه تاریخ‌ها"
            todayShamsi={todayShamsi}
          />
          <button
            type="button"
            onClick={loadCorrespondences}
            className="col-span-2 sm:col-span-1 min-h-[42px] rounded-xl bg-[#0B192C] text-white text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer"
          >
            <Search className="w-3.5 h-3.5 text-[#C5A059]" />
            <span>جست‌وجو</span>
          </button>
        </div>
      </div>

      {/* ================= بخش ۳ (پایین صفحه): آرشیو پیام‌های خوانده‌شده و مکاتبات قبلی ================= */}
      <div className="rounded-2xl bg-white border border-slate-200 p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2">
          <div>
            <h3 className="text-sm font-bold text-[#0B192C]">
              آرشیو پیام‌های خوانده‌شده و مکاتبات قبلی ({toPersianDigits(archivedItems.length)})
            </h3>
            <p className="text-[10.5px] text-slate-500 mt-0.5">
              پیام‌هایی که خوانده و تعیین تکلیف شده‌اند به همراه پیام‌های ارسالی در این بخش آرشیو می‌شوند.
            </p>
          </div>
        </div>

        {loading ? (
          <p className="text-xs text-slate-500 py-5 text-center">در حال بارگذاری آرشیو...</p>
        ) : archivedItems.length === 0 ? (
          <p className="text-xs text-slate-500 py-5 text-center">موردی در آرشیو مکاتبات یافت نشد.</p>
        ) : (
          <div className="space-y-2.5">
            {archivedItems.map((msg) => {
              const defaultAvatar =
                msg.sender_role === 'manager'
                  ? '/assets/media/manager-avatar.svg'
                  : '/assets/media/worker-avatar.svg';

              return (
                <div
                  key={msg.id}
                  className={`rounded-2xl border p-3.5 space-y-2 transition-colors ${
                    msg.sender_role === 'manager'
                      ? 'bg-gradient-to-l from-amber-50/35 via-white to-white border-[#C5A059]/45'
                      : 'bg-gradient-to-l from-sky-50/35 via-white to-white border-sky-200'
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2.5">
                      <img
                        src={msg.sender_avatar_url || defaultAvatar}
                        alt={msg.sender_name}
                        referrerPolicy="no-referrer"
                        onError={(e) => {
                          (e.currentTarget as HTMLImageElement).src = defaultAvatar;
                        }}
                        className="w-8 h-8 rounded-xl object-cover border border-[#C5A059]/60"
                      />
                      <div>
                        <div className="flex items-center gap-1.5 text-xs">
                          <span className="font-bold text-[#0B192C]">
                            {msg.sender_role === 'manager'
                              ? 'مدیریت: مجید نورایی'
                              : 'پرسنل: امید میثمی'}
                          </span>
                          {msg.subject && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="font-semibold text-[#9A7428]">{msg.subject}</span>
                            </>
                          )}
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500 tabular-nums">
                          <span>{toPersianDigits(msg.shamsi_date)}</span>
                          <span aria-hidden="true">·</span>
                          <span>ساعت {toPersianDigits(msg.recorded_time.slice(0, 5))}</span>
                          {msg.delivery_channel !== 'IN_APP' && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="inline-flex items-center gap-1 text-emerald-700 font-medium">
                                <Smartphone className="w-3 h-3" />
                                {msg.delivery_channel === 'BOTH' ? 'داخلی + پیامک' : 'پیامک'}
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 text-[11px]">
                      {msg.is_read ? (
                        <span className="inline-flex items-center gap-1 text-emerald-700 font-semibold">
                          <CheckCheck className="w-3.5 h-3.5" />
                          <span>مشاهده شده (آرشیو)</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-amber-700 font-medium">
                          <Clock className="w-3 h-3" />
                          <span>در انتظار مشاهده گیرنده</span>
                        </span>
                      )}

                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setReplyTo(msg);
                          composeFormRef.current?.scrollIntoView({
                            behavior: 'smooth',
                            block: 'center',
                          });
                        }}
                        className="min-h-[30px] px-2.5 rounded-lg border border-[#C5A059]/60 hover:bg-[#C5A059]/15 text-[#0B192C] font-semibold flex items-center gap-1 cursor-pointer"
                      >
                        <Reply className="w-3 h-3 text-[#9A7428]" />
                        <span>پاسخ</span>
                      </button>
                    </div>
                  </div>

                  {msg.parent_preview && (
                    <div className="rounded-lg bg-slate-100/80 px-2.5 py-1 text-[11px] text-slate-600">
                      پاسخ به: «{msg.parent_preview}»
                    </div>
                  )}

                  {msg.message_text && (
                    <p className="text-xs text-slate-800 leading-6 whitespace-pre-line">
                      {msg.message_text}
                    </p>
                  )}

                  {/* پخش‌کننده پیام صوتی در صورت وجود */}
                  {msg.audio_url && (
                    <div className="pt-1 flex items-center gap-2">
                      <audio
                        src={msg.audio_url}
                        controls
                        className="h-9 w-full max-w-xs"
                        onClick={(e) => e.stopPropagation()}
                      />
                      {msg.audio_duration_seconds && (
                        <span className="text-[11px] text-slate-500 tabular-nums">
                          {formatSec(msg.audio_duration_seconds)}
                        </span>
                      )}
                    </div>
                  )}

                  {/* فایل‌های پیوست با قابلیت پیش‌نمایش پاپ‌آپ و دانلود اختیاری */}
                  {msg.attachments && msg.attachments.length > 0 && (
                    <div className="pt-2 border-t border-slate-100 flex flex-wrap gap-2">
                      {msg.attachments.map((att, idx) => {
                        const isImg =
                          (att.mime_type || '').startsWith('image/') ||
                          /\.(jpg|jpeg|png|webp|gif|svg)$/i.test(att.file_name);
                        return (
                          <div
                            key={`${att.file_url}_${idx}`}
                            onClick={(e) => e.stopPropagation()}
                            className="rounded-xl bg-[#FCF9F2] border border-[#C5A059]/60 p-1.5 flex items-center gap-2"
                          >
                            {isImg ? (
                              <img
                                src={att.file_url}
                                alt={att.file_name}
                                onClick={() => setPreviewFile(att)}
                                className="w-10 h-10 rounded-lg object-cover border border-[#C5A059]/40 cursor-pointer"
                              />
                            ) : (
                              <FileText className="w-5 h-5 text-[#9A7428] ml-1" />
                            )}

                            <div className="min-w-0">
                              <button
                                type="button"
                                onClick={() => setPreviewFile(att)}
                                className="text-[11px] font-bold text-[#0B192C] hover:text-[#9A7428] max-w-[140px] truncate block text-right cursor-pointer"
                              >
                                {att.file_name}
                              </button>
                              <div className="flex items-center gap-2 mt-0.5">
                                <button
                                  type="button"
                                  onClick={() => setPreviewFile(att)}
                                  className="text-[10px] font-bold text-[#9A7428] hover:underline flex items-center gap-0.5 cursor-pointer"
                                >
                                  <Eye className="w-3 h-3" />
                                  <span>پیش‌نمایش</span>
                                </button>
                                <span className="text-slate-300">·</span>
                                <a
                                  href={att.file_url}
                                  download={att.file_name}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-[10px] font-semibold text-slate-600 hover:text-[#0B192C] flex items-center gap-0.5"
                                >
                                  <Download className="w-3 h-3" />
                                  <span>دانلود</span>
                                </a>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* پاپ‌آپ پیش‌نمایش فایل */}
      <FilePreviewModal file={previewFile} onClose={() => setPreviewFile(null)} />

      {/* پاپ‌آپ دوربین موبایل */}
      <CameraCaptureModal
        isOpen={isCameraOpen}
        onClose={() => setIsCameraOpen(false)}
        onCapture={handleCameraCaptured}
        title="ثبت تصویر برای پیوست مکاتبات"
      />
    </div>
  );
};
