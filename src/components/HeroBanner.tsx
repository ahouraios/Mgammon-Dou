import React from 'react';
import {
  CheckCircle2,
  Clock,
  Briefcase,
  Moon,
  AlertCircle,
  BellRing,
  BellOff,
} from 'lucide-react';
import { formatShamsiVerbose, toPersianDigits } from '../shared/jalali';
import { WorkerLiveStatus } from '../shared/types';
import { useNotificationStatus } from './MobileNotificationHelper';

interface HeroBannerProps {
  role: 'manager' | 'worker';
  shamsiDate: string;
  timeHHMM: string;
  bannerBgUrl: string | null;
  userAvatarUrl?: string | null;
  collaborationStartShamsi?: string | null;
  liveStatus?: WorkerLiveStatus;
  statusText?: string;
  statusDetail?: string;
  isOvertimeActive?: boolean;
  onRefresh?: () => void;
  loading?: boolean;
}

const LIVE_STATUS_BADGE: Record<
  WorkerLiveStatus,
  {
    ringClass: string;
    pillClass: string;
    iconBgClass: string;
    Icon: React.FC<{ className?: string }>;
  }
> = {
  PRESENT: {
    ringClass: 'border-emerald-400 ring-3 ring-emerald-500/30',
    pillClass: 'bg-emerald-500/20 text-emerald-200 border border-emerald-400/40',
    iconBgClass: 'bg-emerald-600 text-white',
    Icon: CheckCircle2,
  },
  LATE: {
    ringClass: 'border-amber-400 ring-3 ring-amber-500/30',
    pillClass: 'bg-amber-500/20 text-amber-200 border border-amber-400/40',
    iconBgClass: 'bg-amber-500 text-white',
    Icon: Clock,
  },
  MISSION: {
    ringClass: 'border-purple-400 ring-3 ring-purple-500/30',
    pillClass: 'bg-purple-500/20 text-purple-200 border border-purple-400/40',
    iconBgClass: 'bg-purple-600 text-white',
    Icon: Briefcase,
  },
  FINISHED: {
    ringClass: 'border-[#C5A059] ring-2 ring-[#C5A059]/25',
    pillClass: 'bg-slate-700/70 text-slate-200 border border-slate-500/40',
    iconBgClass: 'bg-slate-600 text-white',
    Icon: Moon,
  },
  ABSENT: {
    ringClass: 'border-red-400 ring-3 ring-red-500/30',
    pillClass: 'bg-red-500/20 text-red-200 border border-red-400/40',
    iconBgClass: 'bg-red-600 text-white',
    Icon: AlertCircle,
  },
};

export const HeroBanner: React.FC<HeroBannerProps> = ({
  role,
  shamsiDate,
  timeHHMM,
  bannerBgUrl,
  userAvatarUrl,
  liveStatus,
  statusText,
  statusDetail,
  isOvertimeActive,
}) => {
  const { isNotificationActive } = useNotificationStatus();
  const effectiveBannerUrl =
    !bannerBgUrl || bannerBgUrl === '/assets/media/banner-bg.svg'
      ? '/assets/media/banner-bg.webp'
      : bannerBgUrl;
  const defaultAvatar =
    role === 'manager' ? '/assets/media/manager-avatar.svg' : '/assets/media/worker-avatar.svg';

  const statusCfg = liveStatus ? LIVE_STATUS_BADGE[liveStatus] || LIVE_STATUS_BADGE.FINISHED : null;
  const StatusIcon = statusCfg?.Icon;

  return (
    <div className="relative overflow-hidden rounded-2xl border border-[#C5A059]/65 bg-[#0B192C] text-white shadow-xs">
      <img
        src={effectiveBannerUrl}
        alt="Mgammon"
        referrerPolicy="no-referrer"
        onError={(e) => {
          const img = e.currentTarget as HTMLImageElement;
          if (!img.dataset.triedUploads) {
            img.dataset.triedUploads = '1';
            img.src = '/uploads/banner-bg.webp';
          } else if (!img.dataset.triedRoot) {
            img.dataset.triedRoot = '1';
            img.src = '/banner-bg.webp';
          }
        }}
        className="absolute inset-0 w-full h-full object-cover opacity-45"
      />

      <div className="relative z-10 bg-gradient-to-l from-[#0B192C]/94 via-[#0B192C]/86 to-[#0f2942]/80 px-3.5 py-3 sm:px-4 sm:py-3.5 flex items-center justify-between gap-2.5">
        <div className="flex items-center gap-3 min-w-0">
          {/* تصویر پروفایل یکپارچه با حلقه وضعیت لحظه‌ای */}
          <div className="relative shrink-0">
            <div
              className={`w-11 h-11 sm:w-13 sm:h-13 rounded-2xl border-2 ${
                statusCfg ? statusCfg.ringClass : 'border-[#C5A059]'
              } bg-[#0B192C] overflow-hidden shadow-sm`}
            >
              <img
                src={userAvatarUrl || defaultAvatar}
                alt={role === 'manager' ? 'مجید نورایی' : 'امید میثمی'}
                referrerPolicy="no-referrer"
                onError={(e) => {
                  (e.currentTarget as HTMLImageElement).src = defaultAvatar;
                }}
                className="w-full h-full object-cover"
              />
            </div>

            {statusCfg && StatusIcon && (
              <div
                className={`absolute -bottom-1 -right-1 w-5 h-5 rounded-md ${statusCfg.iconBgClass} border border-[#0B192C] flex items-center justify-center shadow-xs`}
              >
                <StatusIcon className="w-3 h-3" />
              </div>
            )}

            {isOvertimeActive && (
              <div
                title="در حال ثبت اضافه‌کاری"
                className="animate-overtime-plus absolute -top-1 -left-1 w-5 h-5 rounded-md bg-[#C5A059] border border-[#0B192C] text-[#0B192C] font-extrabold text-xs flex items-center justify-center shadow-sm select-none"
              >
                +
              </div>
            )}
          </div>

          <div className="space-y-0.5 min-w-0">
            <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-[#C5A059] font-medium">
              <span>{shamsiDate ? formatShamsiVerbose(shamsiDate) : ''}</span>
              <span aria-hidden="true">·</span>
              <span className="tabular-nums text-slate-300">{toPersianDigits(shamsiDate)}</span>
              {timeHHMM && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="tabular-nums text-emerald-300">
                    ساعت {toPersianDigits(timeHHMM)}
                  </span>
                </>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              <h2 className="text-sm sm:text-base font-extrabold tracking-tight text-white truncate">
                {role === 'manager' ? 'مجید نورایی' : 'امید میثمی'}
              </h2>
              <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-[#C5A059]/20 text-[#C5A059] border border-[#C5A059]/40 font-semibold">
                {role === 'manager' ? 'مدیریت' : 'پرسنل'}
              </span>
              {statusCfg && statusText && (
                <span className={`text-[10px] px-2 py-0.5 rounded-md font-bold ${statusCfg.pillClass}`}>
                  {statusText}
                </span>
              )}
              {isOvertimeActive && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-amber-400/20 text-amber-300 border border-amber-400/40 font-bold">
                  + اضافه‌کاری فعال
                </span>
              )}
            </div>

            {statusDetail && (
              <p className="text-[10px] text-slate-300 truncate">{statusDetail}</p>
            )}
          </div>
        </div>

        {/* آیکون کوچک وضعیت نوتیفیکیشن بدون هیچ نوشته‌ای */}
        <div className="shrink-0 flex items-center">
          <div
            title={
              isNotificationActive
                ? 'نوتیفیکیشن فعال است'
                : 'نوتیفیکیشن غیرفعال است (فعال‌سازی از بخش تنظیمات)'
            }
            aria-label={isNotificationActive ? 'نوتیفیکیشن فعال' : 'نوتیفیکیشن غیرفعال'}
            className={`w-6 h-6 rounded-lg flex items-center justify-center border transition-colors ${
              isNotificationActive
                ? 'bg-emerald-500/20 border-emerald-400/50 text-emerald-300'
                : 'bg-slate-800/60 border-slate-600/50 text-slate-400'
            }`}
          >
            {isNotificationActive ? (
              <BellRing className="w-3 h-3" />
            ) : (
              <BellOff className="w-3 h-3" />
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

