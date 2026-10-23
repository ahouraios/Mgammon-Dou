import React from 'react';
import { WorkerLiveStatus } from '../shared/types';

interface WorkerStatusAvatarProps {
  status: WorkerLiveStatus;
  statusText: string;
  statusDetail: string;
  isOvertimeActive: boolean;
}

const STATUS_STYLE_MAP: Record<
  WorkerLiveStatus,
  {
    figureColor: string;
    ringColor: string;
    surfaceBg: string;
    textColor: string;
    codeLabel: string;
  }
> = {
  PRESENT: {
    figureColor: '#16A34A', // سبز: حاضر در محل کار
    ringColor: 'border-emerald-600/35',
    surfaceBg: 'bg-emerald-50/70',
    textColor: 'text-emerald-900',
    codeLabel: 'حاضر در محل کار',
  },
  LATE: {
    figureColor: '#EA580C', // نارنجی: حضور با تأخیر
    ringColor: 'border-orange-500/40',
    surfaceBg: 'bg-orange-50/70',
    textColor: 'text-orange-900',
    codeLabel: 'حضور با تأخیر',
  },
  MISSION: {
    figureColor: '#7C3AED', // بنفش: مأموریت
    ringColor: 'border-purple-600/40',
    surfaceBg: 'bg-purple-50/70',
    textColor: 'text-purple-900',
    codeLabel: 'در مأموریت',
  },
  FINISHED: {
    figureColor: '#64748B', // خاکستری: پایان کار
    ringColor: 'border-slate-400/40',
    surfaceBg: 'bg-slate-100/80',
    textColor: 'text-slate-800',
    codeLabel: 'پایان کار / خارج از شیفت',
  },
  ABSENT: {
    figureColor: '#DC2626', // قرمز: غیبت
    ringColor: 'border-red-600/40',
    surfaceBg: 'bg-red-50/70',
    textColor: 'text-red-900',
    codeLabel: 'غیبت',
  },
};

export const WorkerStatusAvatar: React.FC<WorkerStatusAvatarProps> = ({
  status,
  statusText,
  statusDetail,
  isOvertimeActive,
}) => {
  const cfg = STATUS_STYLE_MAP[status] || STATUS_STYLE_MAP.FINISHED;

  return (
    <div
      className={`rounded-2xl border border-[#C5A059]/45 bg-white p-4 sm:p-5 shadow-xs flex items-center gap-4`}
      role="status"
      aria-live="polite"
    >
      {/* نشانگر آدمک وضعیت نیرو */}
      <div
        className={`relative w-16 h-16 rounded-2xl border-2 ${cfg.ringColor} ${cfg.surfaceBg} flex items-center justify-center shrink-0`}
      >
        <svg
          viewBox="0 0 64 64"
          className="w-11 h-11"
          fill="none"
          aria-hidden="true"
        >
          {/* سر آدمک */}
          <circle cx="32" cy="18" r="10" fill={cfg.figureColor} />
          {/* تنه و شانه‌های آدمک */}
          <path
            d="M14 52C14 40.9543 22.0589 32 32 32C41.9411 32 50 40.9543 50 52V55H14V52Z"
            fill={cfg.figureColor}
          />
          {/* یقه طلایی ظریف */}
          <path
            d="M26 33L32 40L38 33"
            stroke="#C5A059"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>

        {/* نشانگر متحرک «+» فقط هنگامی که قواعد زمانی اضافه‌کاری واقعاً برقرار باشند */}
        {isOvertimeActive && (
          <div
            title="در حال ثبت اضافه‌کاری بر اساس قواعد زمانی شیفت"
            className="animate-overtime-plus absolute -top-2 -left-2 w-7 h-7 rounded-xl bg-[#0B192C] border border-[#C5A059] text-[#C5A059] font-bold text-base flex items-center justify-center shadow-sm select-none"
          >
            +
          </div>
        )}
      </div>

      {/* شرح متنی وضعیت (رنگ به تنهایی معیار تشخیص نیست) */}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
          <span>وضعیت لحظه‌ای نیروی کاری</span>
          <span aria-hidden="true">·</span>
          <span className="font-medium text-[#0B192C]">{cfg.codeLabel}</span>
          {isOvertimeActive && (
            <>
              <span aria-hidden="true">·</span>
              <span className="font-semibold text-[#9A7428]">+ در حال اضافه‌کاری</span>
            </>
          )}
        </div>
        <h2 className={`mt-1 text-base sm:text-lg font-bold ${cfg.textColor} truncate`}>
          {statusText}
        </h2>
        <p className="mt-0.5 text-xs text-slate-600 leading-5">
          {statusDetail}
        </p>
      </div>
    </div>
  );
};
