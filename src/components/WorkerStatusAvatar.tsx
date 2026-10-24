import React from 'react';
import {
  CheckCircle2,
  Clock,
  Briefcase,
  Moon,
  AlertCircle,
  Wallet,
  Phone,
} from 'lucide-react';
import { FinancialTransaction, WorkerLiveStatus } from '../shared/types';
import { formatToman, toPersianDigits } from '../shared/jalali';
import { TX_TYPE_LABELS } from '../services/api';

interface WorkerStatusAvatarProps {
  status: WorkerLiveStatus;
  statusText: string;
  statusDetail: string;
  isOvertimeActive: boolean;
  workerAvatarUrl?: string | null;
  approvedPaymentsToman?: number;
  approvedTransactions?: FinancialTransaction[];
  pendingPaymentsCount?: number;
  workerPhone?: string | null;
  onOpenFinance?: () => void;
}

const STATUS_STYLE_MAP: Record<
  WorkerLiveStatus,
  {
    ringBorder: string;
    cardGradient: string;
    badgeBg: string;
    badgeText: string;
    textColor: string;
    codeLabel: string;
    IconComponent: React.FC<{ className?: string }>;
  }
> = {
  PRESENT: {
    ringBorder: 'border-emerald-500 ring-4 ring-emerald-500/20',
    cardGradient: 'bg-gradient-to-l from-emerald-50/90 via-white to-teal-50/50 border-emerald-300',
    badgeBg: 'bg-emerald-600 text-white',
    badgeText: 'text-emerald-800',
    textColor: 'text-emerald-950',
    codeLabel: 'حاضر در محل کار',
    IconComponent: CheckCircle2,
  },
  LATE: {
    ringBorder: 'border-orange-500 ring-4 ring-orange-500/20',
    cardGradient: 'bg-gradient-to-l from-orange-50/90 via-white to-amber-50/50 border-orange-300',
    badgeBg: 'bg-orange-500 text-white',
    badgeText: 'text-orange-800',
    textColor: 'text-orange-950',
    codeLabel: 'حضور با تأخیر',
    IconComponent: Clock,
  },
  MISSION: {
    ringBorder: 'border-purple-600 ring-4 ring-purple-500/20',
    cardGradient: 'bg-gradient-to-l from-purple-50/90 via-white to-fuchsia-50/50 border-purple-300',
    badgeBg: 'bg-purple-600 text-white',
    badgeText: 'text-purple-800',
    textColor: 'text-purple-950',
    codeLabel: 'در مأموریت',
    IconComponent: Briefcase,
  },
  FINISHED: {
    ringBorder: 'border-slate-400 ring-4 ring-slate-300/30',
    cardGradient: 'bg-gradient-to-l from-slate-50 via-white to-sky-50/40 border-[#C5A059]/55',
    badgeBg: 'bg-slate-600 text-white',
    badgeText: 'text-[#ef0404]',
    textColor: 'text-[#0B192C]',
    codeLabel: 'خارج از شیفت',
    IconComponent: Moon,
  },
  ABSENT: {
    ringBorder: 'border-red-600 ring-4 ring-red-500/20',
    cardGradient: 'bg-gradient-to-l from-red-50/90 via-white to-rose-50/50 border-red-300',
    badgeBg: 'bg-red-600 text-white',
    badgeText: 'text-red-800',
    textColor: 'text-red-950',
    codeLabel: 'غیبت',
    IconComponent: AlertCircle,
  },
};

export const WorkerStatusAvatar: React.FC<WorkerStatusAvatarProps> = ({
  status,
  statusText,
  statusDetail,
  isOvertimeActive,
  workerAvatarUrl,
  approvedPaymentsToman = 0,
  approvedTransactions = [],
  pendingPaymentsCount = 0,
  workerPhone,
  onOpenFinance,
}) => {
  const cfg = STATUS_STYLE_MAP[status] || STATUS_STYLE_MAP.FINISHED;
  const StatusIcon = cfg.IconComponent;
  const recentApproved = approvedTransactions.slice(0, 3);

  return (
    <div
      className={`rounded-2xl border ${cfg.cardGradient} p-3.5 sm:p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-2xs transition-colors`}
      role="status"
      aria-live="polite"
    >
      <div className="flex items-center gap-3.5 min-w-0">
        {/* تصویر پرسنل (امید میثمی) با حلقه رنگی وضعیت، آیکون وضعیت و نشانگر + اضافه‌کاری */}
        <div className="relative shrink-0">
          <div
            className={`w-14 h-14 sm:w-16 sm:h-16 rounded-2xl border-2 ${cfg.ringBorder} bg-white overflow-hidden flex items-center justify-center transition-all`}
          >
            <img
              src={workerAvatarUrl || '/assets/media/worker-avatar.svg'}
              alt="پرسنل: امید میثمی"
              referrerPolicy="no-referrer"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).src = '/assets/media/worker-avatar.svg';
              }}
              className="w-full h-full object-cover"
            />
          </div>

          <div
            title={cfg.codeLabel}
            className={`absolute -bottom-1 -right-1 w-6 h-6 rounded-lg ${cfg.badgeBg} border-2 border-white flex items-center justify-center shadow-xs`}
          >
            <StatusIcon className="w-3.5 h-3.5" />
          </div>

          {isOvertimeActive && (
            <div
              title="در حال ثبت اضافه‌کاری"
              className="animate-overtime-plus absolute -top-1.5 -left-1.5 w-6 h-6 rounded-lg bg-[#0B192C] border-2 border-[#C5A059] text-[#C5A059] font-extrabold text-sm flex items-center justify-center shadow-sm select-none"
            >
              +
            </div>
          )}
        </div>

        <div className="min-w-0 flex-1 space-y-0.5">
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className="font-extrabold text-[#0B192C]">پرسنل: امید میثمی</span>
            <span aria-hidden="true" className="text-slate-400">
              ·
            </span>
            <span className={`font-bold text-[#ef0404] ${cfg.badgeText}`}>{cfg.codeLabel}</span>
            {isOvertimeActive && (
              <>
                <span aria-hidden="true" className="text-slate-400">
                  ·
                </span>
                <span className="font-bold text-[#9A7428]">+ اضافه‌کاری</span>
              </>
            )}
          </div>

          <h3 className={`text-sm font-extrabold ${cfg.textColor} truncate`}>{statusText}</h3>

          <p className="text-[11px] sm:text-xs text-slate-600 leading-5">{statusDetail}</p>
        </div>
      </div>

      {/* کادر سبز رنگ پرداختی‌های تأییدشده (کشیده‌شده در تمام عرض کادر در موبایل و عنوان و مبلغ در یک خط) + لیست پرداختی‌های تأییدشده */}
      <div className="w-full sm:w-auto flex flex-col sm:items-end justify-between gap-2 pt-2.5 sm:pt-0 border-t sm:border-t-0 border-slate-200/70 shrink-0 text-xs">
        <div
          onClick={onOpenFinance}
          title={onOpenFinance ? 'مشاهده جزئیات امور مالی و پرداختی‌ها' : undefined}
          className={`w-full sm:w-auto flex items-center justify-between sm:justify-end gap-2 px-3 py-2 rounded-xl bg-emerald-50/95 border border-emerald-200/90 text-[#0B192C] tabular-nums shadow-2xs ${
            onOpenFinance ? 'hover:bg-emerald-100/80 transition-colors cursor-pointer' : ''
          }`}
        >
          <div className="flex items-center gap-1.5">
            <Wallet className="w-4 h-4 text-emerald-700 shrink-0" />
            <span className="text-[11px] font-bold text-emerald-900 whitespace-nowrap">
              پرداختی‌های تأییدشده:
            </span>
          </div>
          <strong className="text-xs sm:text-sm font-extrabold text-[#0B192C] whitespace-nowrap">
            {formatToman(approvedPaymentsToman)}
          </strong>
        </div>

        {recentApproved.length > 0 && (
          <div className="w-full sm:w-auto flex flex-col gap-1 bg-white/80 rounded-xl border border-emerald-100 px-2.5 py-1.5">
            {recentApproved.map((tx) => (
              <div
                key={tx.id}
                onClick={onOpenFinance}
                className="flex items-center justify-between gap-3 text-[10.5px] text-slate-700 tabular-nums cursor-pointer"
              >
                <span className="truncate font-medium text-slate-600">
                  {TX_TYPE_LABELS[tx.tx_type]} ({toPersianDigits(tx.shamsi_date)}):
                </span>
                <span className="font-bold text-emerald-800 whitespace-nowrap">
                  {formatToman(tx.amount_toman)}
                </span>
              </div>
            ))}
          </div>
        )}

        <div className="w-full sm:w-auto flex items-center justify-between sm:justify-end gap-2 text-[11px]">
          {pendingPaymentsCount > 0 && (
            <button
              type="button"
              onClick={onOpenFinance}
              className="px-2 py-0.5 rounded-lg bg-amber-50 border border-amber-300 text-[#9A7428] font-bold tabular-nums cursor-pointer"
            >
              {toPersianDigits(pendingPaymentsCount)} مورد در انتظار تأیید
            </button>
          )}
          {workerPhone && (
            <div className="flex items-center gap-1 text-slate-600 tabular-nums">
              <Phone className="w-3.5 h-3.5 text-emerald-600" />
              <span>{toPersianDigits(workerPhone)}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};


