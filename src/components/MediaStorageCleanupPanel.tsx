import React, { useEffect, useState, useCallback } from 'react';
import {
  HardDrive,
  Trash2,
  Mic,
  Image as ImageIcon,
  FileText,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  Eye,
  CheckSquare,
  Square,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { MediaSourceType, MediaStorageItem, MediaStorageSummary, UserRole } from '../shared/types';
import { apiRequest } from '../services/api';
import { toPersianDigits } from '../shared/jalali';

interface MediaStorageCleanupPanelProps {
  role: UserRole;
  onDataChanged?: () => void;
}

export function formatBytesPersian(bytes: number): string {
  if (!bytes || bytes <= 0) return '۰ بایت';
  if (bytes < 1024) return `${toPersianDigits(bytes)} بایت`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${toPersianDigits(kb.toFixed(1))} کیلوبایت`;
  const mb = kb / 1024;
  return `${toPersianDigits(mb.toFixed(2))} مگابایت`;
}

export const MediaStorageCleanupPanel: React.FC<MediaStorageCleanupPanelProps> = ({
  role,
  onDataChanged,
}) => {
  const [storage, setStorage] = useState<MediaStorageSummary | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [actionLoading, setActionLoading] = useState<boolean>(false);
  const [filterCategory, setFilterCategory] = useState<'ALL' | 'AUDIO' | 'IMAGE' | 'DOCUMENT'>('ALL');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [confirmCleanupModal, setConfirmCleanupModal] = useState<{
    title: string;
    description: string;
    payload: {
      items?: Array<{ source_type: MediaSourceType; record_id: number | null; file_url: string }>;
      older_than_days?: number;
      category?: string;
    };
  } | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const loadStorageInfo = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiRequest<{ ok: boolean; storage: MediaStorageSummary }>('/api/media/storage');
      if (res.ok && res.storage) {
        setStorage(res.storage);
        setSelectedIds(new Set());
      }
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'خطا در دریافت اطلاعات فضای ذخیره‌سازی هاست.',
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStorageInfo();
  }, [loadStorageInfo]);

  const filteredItems = (storage?.items || []).filter((item) =>
    filterCategory === 'ALL' ? true : item.category === filterCategory
  );

  const toggleSelectItem = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAllFiltered = () => {
    if (filteredItems.length === 0) return;
    const allSelected = filteredItems.every((i) => selectedIds.has(i.id));
    if (allSelected) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        filteredItems.forEach((i) => next.delete(i.id));
        return next;
      });
    } else {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        filteredItems.forEach((i) => next.add(i.id));
        return next;
      });
    }
  };

  const executeCleanup = async () => {
    if (!confirmCleanupModal) return;
    setActionLoading(true);
    setFeedback(null);
    try {
      const res = await apiRequest<{
        ok: boolean;
        deletedCount: number;
        freedBytes: number;
        message: string;
      }>('/api/media/cleanup', {
        method: 'POST',
        body: JSON.stringify(confirmCleanupModal.payload),
      });
      setFeedback({
        type: 'success',
        text: `${res.message} (فضای آزادشده: ${formatBytesPersian(res.freedBytes)})`,
      });
      setConfirmCleanupModal(null);
      await loadStorageInfo();
      if (onDataChanged) onDataChanged();
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'خطا در پاکسازی فایل‌ها از حافظه هاست.',
      });
    } finally {
      setActionLoading(false);
    }
  };

  const handleBulkSelectedDelete = () => {
    if (!storage || selectedIds.size === 0) return;
    const selectedItems = storage.items.filter((i) => selectedIds.has(i.id));
    const totalSelectedBytes = selectedItems.reduce((acc, cur) => acc + cur.size_bytes, 0);
    setConfirmCleanupModal({
      title: `حذف ${toPersianDigits(selectedItems.length)} فایل انتخاب‌شده از حافظه هاست`,
      description: `آیا از حذف فیزیکی ${toPersianDigits(selectedItems.length)} فایل انتخاب‌شده (با حجم مجموع ${formatBytesPersian(totalSelectedBytes)}) اطمینان دارید؟ متن گزارش‌ها، پیام‌ها و ارقام مالی بدون هیچ تغییری در سامانه باقی خواهند ماند.`,
      payload: {
        items: selectedItems.map((i) => ({
          source_type: i.source_type,
          record_id: i.record_id,
          file_url: i.file_url,
        })),
      },
    });
  };

  const getSourceBadgeLabel = (sourceType: MediaSourceType): string => {
    switch (sourceType) {
      case 'CORRESPONDENCE_AUDIO':
        return 'فایل صوتی مکاتبات';
      case 'CORRESPONDENCE_ATTACHMENT':
        return 'پیوست مکاتبات کاری';
      case 'REPORT_PHOTO':
        return 'تصویر گزارش کار روزانه';
      case 'FINANCE_RECEIPT':
        return 'تصویر رسید / فاکتور مالی';
      case 'HISTORICAL_EXCEL':
        return 'فایل اکسل آرشیو کارکرد';
      default:
        return 'فایل ذخیره‌شده در هاست';
    }
  };

  return (
    <div className="bg-white rounded-3xl border border-[#E5DFD3] p-5 sm:p-6 shadow-sm space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#EFECE6] pb-4">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl bg-[#14233C] text-[#C5A059] flex items-center justify-center shadow-sm">
            <HardDrive className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-sm sm:text-base font-black text-[#14233C]">
              مدیریت فضای ذخیره‌سازی هاست و پاکسازی فایل‌های چندرسانه‌ای
            </h3>
            <p className="text-xs text-[#64748B] mt-0.5">
              پاکسازی امن فایل‌های صوتی، تصاویر و پیوست‌های ارسالی جهت بهینه‌سازی فضای سرور (قابل استفاده توسط{' '}
              {role === 'manager' ? 'مدیریت و پرسنل' : 'پرسنل و مدیریت'})
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={loadStorageInfo}
          disabled={loading || actionLoading}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-[#E5DFD3] bg-[#FAF8F5] hover:bg-[#F3EFE6] text-xs font-bold text-[#14233C] transition cursor-pointer"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          بروزرسانی وضعیت فضا
        </button>
      </div>

      {/* Security & Data Preservation Assurance Note */}
      <div className="rounded-2xl bg-emerald-50/70 border border-emerald-200 p-3.5 flex items-start gap-2.5 text-xs text-emerald-900 leading-6">
        <ShieldCheck className="w-4 h-4 text-emerald-700 shrink-0 mt-1" />
        <div>
          <span className="font-black">تضمین صیانت از داده‌های متنی و محاسباتی: </span>
          حذف فایل‌های صوتی، تصاویر گزارش کار یا رسیدهای پیوست صرفاً فایل حجیم را از حافظه هاست پاک می‌کند و{' '}
          <span className="font-bold underline">
            متن پیام‌ها، شرح گزارش‌های روزانه، مبالغ تراکنش‌های مالی و ساعات کارکرد به هیچ عنوان حذف نمی‌شوند.
          </span>
        </div>
      </div>

      {feedback && (
        <div
          className={`p-3.5 rounded-2xl border text-xs font-bold flex items-center justify-between gap-2 ${
            feedback.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-rose-50 border-rose-200 text-rose-800'
          }`}
        >
          <div className="flex items-center gap-2">
            {feedback.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
            ) : (
              <AlertTriangle className="w-4 h-4 shrink-0 text-rose-600" />
            )}
            <span>{feedback.text}</span>
          </div>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            className="text-[11px] underline opacity-75 hover:opacity-100 cursor-pointer"
          >
            بستن
          </button>
        </div>
      )}

      {/* Storage KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="rounded-2xl border border-[#E5DFD3] bg-[#FAF8F5] p-3.5">
          <div className="flex items-center justify-between text-xs text-[#64748B] mb-1">
            <span>کل فضای اشغال‌شده</span>
            <HardDrive className="w-4 h-4 text-[#14233C]" />
          </div>
          <div className="text-base font-black text-[#14233C]">
            {storage ? formatBytesPersian(storage.total_size_bytes) : '...'}
          </div>
          <div className="text-[11px] text-[#64748B] mt-0.5">
            {toPersianDigits(storage?.total_files_count || 0)} فایل چندرسانه‌ای
          </div>
        </div>

        <div className="rounded-2xl border border-amber-200 bg-amber-50/40 p-3.5">
          <div className="flex items-center justify-between text-xs text-amber-900 mb-1">
            <span>فایل‌های صوتی (ویس)</span>
            <Mic className="w-4 h-4 text-amber-700" />
          </div>
          <div className="text-base font-black text-amber-900">
            {storage ? formatBytesPersian(storage.audio_size_bytes) : '...'}
          </div>
          <div className="text-[11px] text-amber-800 mt-0.5">
            {toPersianDigits(storage?.audio_files_count || 0)} پیام صوتی
          </div>
        </div>

        <div className="rounded-2xl border border-blue-200 bg-blue-50/40 p-3.5">
          <div className="flex items-center justify-between text-xs text-blue-900 mb-1">
            <span>تصاویر گزارش و مالی</span>
            <ImageIcon className="w-4 h-4 text-blue-700" />
          </div>
          <div className="text-base font-black text-blue-900">
            {storage ? formatBytesPersian(storage.image_size_bytes) : '...'}
          </div>
          <div className="text-[11px] text-blue-800 mt-0.5">
            {toPersianDigits(storage?.image_files_count || 0)} فایل تصویری
          </div>
        </div>

        <div className="rounded-2xl border border-purple-200 bg-purple-50/40 p-3.5">
          <div className="flex items-center justify-between text-xs text-purple-900 mb-1">
            <span>اسناد و پیوست‌ها</span>
            <FileText className="w-4 h-4 text-purple-700" />
          </div>
          <div className="text-base font-black text-purple-900">
            {storage ? formatBytesPersian(storage.document_size_bytes) : '...'}
          </div>
          <div className="text-[11px] text-purple-800 mt-0.5">
            {toPersianDigits(storage?.document_files_count || 0)} سند پیوست
          </div>
        </div>
      </div>

      {/* Quick Bulk Cleanup Actions */}
      <div className="rounded-2xl border border-[#E5DFD3] bg-[#FAF8F5] p-4 space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <span className="text-xs font-black text-[#14233C] flex items-center gap-1.5">
            <Sparkles className="w-4 h-4 text-[#C5A059]" />
            عملیات پاکسازی سریع و آزادسازی خودکار فضای هاست:
          </span>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={!storage || storage.total_files_count === 0 || actionLoading}
            onClick={() =>
              setConfirmCleanupModal({
                title: 'پاکسازی فایل‌های قدیمی‌تر از ۳۰ روز',
                description:
                  'کلیه فایل‌های صوتی، تصاویر و پیوست‌هایی که بیش از ۳۰ روز از زمان ثبت آن‌ها گذشته است از حافظه هاست حذف می‌شوند تا فضای سرور آزاد شود.',
                payload: { older_than_days: 30, category: filterCategory },
              })
            }
            className="px-3.5 py-2 rounded-xl bg-white border border-[#E5DFD3] hover:border-amber-400 text-xs font-bold text-[#14233C] transition disabled:opacity-45 cursor-pointer"
          >
            پاکسازی فایل‌های قدیمی‌تر از ۳۰ روز
          </button>

          <button
            type="button"
            disabled={!storage || storage.total_files_count === 0 || actionLoading}
            onClick={() =>
              setConfirmCleanupModal({
                title: 'پاکسازی فایل‌های قدیمی‌تر از ۷ روز',
                description:
                  'کلیه فایل‌های صوتی، تصاویر و پیوست‌هایی که بیش از ۷ روز از زمان ثبت آن‌ها گذشته است از حافظه هاست حذف می‌شوند.',
                payload: { older_than_days: 7, category: filterCategory },
              })
            }
            className="px-3.5 py-2 rounded-xl bg-white border border-[#E5DFD3] hover:border-amber-400 text-xs font-bold text-[#14233C] transition disabled:opacity-45 cursor-pointer"
          >
            پاکسازی فایل‌های قدیمی‌تر از ۷ روز
          </button>

          <button
            type="button"
            disabled={!storage || storage.audio_files_count === 0 || actionLoading}
            onClick={() =>
              setConfirmCleanupModal({
                title: 'پاکسازی کلیه فایل‌های صوتی (ویس‌ها)',
                description:
                  'تمامی فایل‌های صوتی ضبط‌شده در بخش مکاتبات از روی هاست پاک می‌شوند و فضای آن‌ها آزاد می‌گردد.',
                payload: { older_than_days: 0, category: 'AUDIO' },
              })
            }
            className="px-3.5 py-2 rounded-xl bg-amber-50 border border-amber-200 hover:bg-amber-100 text-xs font-bold text-amber-900 transition disabled:opacity-45 cursor-pointer"
          >
            حذف یکجای تمام فایل‌های صوتی ({toPersianDigits(storage?.audio_files_count || 0)})
          </button>

          {selectedIds.size > 0 && (
            <button
              type="button"
              onClick={handleBulkSelectedDelete}
              disabled={actionLoading}
              className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-black flex items-center gap-1.5 shadow-sm transition cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
              حذف موارد انتخاب‌شده ({toPersianDigits(selectedIds.size)} فایل)
            </button>
          )}
        </div>
      </div>

      {/* Category Filter & Select All */}
      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
        <div className="flex flex-wrap gap-1.5">
          {[
            { id: 'ALL', label: `همه فایل‌ها (${toPersianDigits(storage?.total_files_count || 0)})` },
            { id: 'AUDIO', label: `فایل‌های صوتی (${toPersianDigits(storage?.audio_files_count || 0)})` },
            { id: 'IMAGE', label: `تصاویر گزارش و رسید (${toPersianDigits(storage?.image_files_count || 0)})` },
            { id: 'DOCUMENT', label: `اسناد و پیوست‌ها (${toPersianDigits(storage?.document_files_count || 0)})` },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setFilterCategory(tab.id as 'ALL' | 'AUDIO' | 'IMAGE' | 'DOCUMENT')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer ${
                filterCategory === tab.id
                  ? 'bg-[#14233C] text-[#C5A059] shadow-sm'
                  : 'bg-[#FAF8F5] text-[#475569] border border-[#E5DFD3] hover:bg-[#EFECE6]'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {filteredItems.length > 0 && (
          <button
            type="button"
            onClick={toggleSelectAllFiltered}
            className="inline-flex items-center gap-1.5 text-xs font-bold text-[#14233C] hover:text-[#9A7228] px-2.5 py-1.5 rounded-lg bg-[#FAF8F5] border border-[#E5DFD3] cursor-pointer"
          >
            {filteredItems.every((i) => selectedIds.has(i.id)) ? (
              <>
                <CheckSquare className="w-3.5 h-3.5 text-[#9A7228]" />
                لغو انتخاب همه
              </>
            ) : (
              <>
                <Square className="w-3.5 h-3.5 text-[#64748B]" />
                انتخاب همه موارد این لیست
              </>
            )}
          </button>
        )}
      </div>

      {/* Confirmation Modal / Banner */}
      {confirmCleanupModal && (
        <div className="rounded-2xl border-2 border-rose-300 bg-rose-50/90 p-4 space-y-3 shadow-sm">
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
            <div>
              <h4 className="text-xs sm:text-sm font-black text-rose-950">
                {confirmCleanupModal.title}
              </h4>
              <p className="text-xs text-rose-900 mt-1 leading-6">
                {confirmCleanupModal.description}
              </p>
            </div>
          </div>
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              disabled={actionLoading}
              onClick={() => setConfirmCleanupModal(null)}
              className="px-3.5 py-2 rounded-xl bg-white border border-rose-200 text-xs font-bold text-slate-700 hover:bg-slate-50 cursor-pointer"
            >
              انصراف
            </button>
            <button
              type="button"
              disabled={actionLoading}
              onClick={executeCleanup}
              className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-black flex items-center gap-1.5 shadow-sm cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
              {actionLoading ? 'در حال حذف و آزادسازی فضا...' : 'تأیید و حذف نهایی از هاست'}
            </button>
          </div>
        </div>
      )}

      {/* Files List */}
      {loading ? (
        <div className="py-10 text-center text-xs font-bold text-[#64748B]">
          در حال بررسی دایرکتوری فایل‌های چندرسانه‌ای هاست...
        </div>
      ) : filteredItems.length === 0 ? (
        <div className="py-10 text-center rounded-2xl border border-dashed border-[#E5DFD3] bg-[#FAF8F5]">
          <CheckCircle2 className="w-8 h-8 text-emerald-600 mx-auto mb-2 opacity-80" />
          <p className="text-xs font-black text-[#14233C]">
            هیچ فایل چندرسانه‌ای در این بخش وجود ندارد و فضای هاست کاملاً بهینه است.
          </p>
        </div>
      ) : (
        <div className="space-y-2.5 max-h-[440px] overflow-y-auto pr-1">
          {filteredItems.map((item) => {
            const isSelected = selectedIds.has(item.id);
            return (
              <div
                key={item.id}
                className={`p-3.5 rounded-2xl border transition flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                  isSelected
                    ? 'border-[#C5A059] bg-amber-50/40'
                    : 'border-[#E5DFD3] bg-white hover:bg-[#FAF8F5]'
                }`}
              >
                <div className="flex items-start gap-3 min-w-0">
                  <button
                    type="button"
                    onClick={() => toggleSelectItem(item.id)}
                    className="mt-1 text-[#14233C] cursor-pointer"
                    title="انتخاب جهت حذف گروهی"
                  >
                    {isSelected ? (
                      <CheckSquare className="w-4 h-4 text-[#9A7228]" />
                    ) : (
                      <Square className="w-4 h-4 text-[#94A3B8]" />
                    )}
                  </button>

                  <div
                    className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                      item.category === 'AUDIO'
                        ? 'bg-amber-100 text-amber-800'
                        : item.category === 'IMAGE'
                          ? 'bg-blue-100 text-blue-800'
                          : 'bg-purple-100 text-purple-800'
                    }`}
                  >
                    {item.category === 'AUDIO' ? (
                      <Mic className="w-4 h-4" />
                    ) : item.category === 'IMAGE' ? (
                      <ImageIcon className="w-4 h-4" />
                    ) : (
                      <FileText className="w-4 h-4" />
                    )}
                  </div>

                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-[11px] font-black px-2 py-0.5 rounded-md bg-[#14233C]/10 text-[#14233C]">
                        {getSourceBadgeLabel(item.source_type)}
                      </span>
                      <span className="text-[11px] font-bold text-[#64748B]" dir="ltr">
                        {toPersianDigits(item.shamsi_date)}
                        {item.recorded_time ? ` - ${toPersianDigits(item.recorded_time)}` : ''}
                      </span>
                      <span className="text-[11px] font-black text-amber-800 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-md">
                        {formatBytesPersian(item.size_bytes)}
                      </span>
                    </div>

                    <p className="text-xs font-bold text-[#14233C] truncate">
                      {item.title_or_context}
                    </p>

                    {item.category === 'AUDIO' && item.exists_on_disk && (
                      <audio
                        controls
                        preload="none"
                        src={item.file_url}
                        className="h-8 w-full max-w-xs mt-1"
                      />
                    )}
                  </div>
                </div>

                <div className="flex items-center justify-end gap-2 shrink-0">
                  {item.exists_on_disk && (
                    <a
                      href={item.file_url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl border border-[#E5DFD3] bg-[#FAF8F5] hover:bg-[#EFECE6] text-[11px] font-bold text-[#14233C]"
                    >
                      <Eye className="w-3.5 h-3.5" />
                      مشاهده
                    </a>
                  )}

                  <button
                    type="button"
                    disabled={actionLoading}
                    onClick={() =>
                      setConfirmCleanupModal({
                        title: 'حذف فایل و آزادسازی فضای هاست',
                        description: `آیا از حذف فایل «${item.title_or_context}» به حجم ${formatBytesPersian(item.size_bytes)} اطمینان دارید؟ متن رکورد حفظ خواهد شد.`,
                        payload: {
                          items: [
                            {
                              source_type: item.source_type,
                              record_id: item.record_id,
                              file_url: item.file_url,
                            },
                          ],
                        },
                      })
                    }
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-rose-50 hover:bg-rose-100 border border-rose-200 text-rose-700 text-[11px] font-black transition cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    حذف فایل
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
