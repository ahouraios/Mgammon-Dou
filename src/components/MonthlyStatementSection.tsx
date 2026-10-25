import React, { useMemo, useState } from 'react';
import {
  Calendar,
  ChevronDown,
  ChevronUp,
  CreditCard,
  FileSpreadsheet,
  Layers,
  Receipt,
  TrendingUp,
  Wallet,
} from 'lucide-react';
import {
  generateStatementPeriods,
  PeriodStatementSummary,
  STANDARD_MONTHLY_WORK_DAYS,
} from '../shared/calculationEngine';
import {
  formatMinutesToDurationPersian,
  formatMinutesToHHMM,
  formatToman,
  toPersianDigits,
} from '../shared/jalali';
import {
  DailyAttendanceSummary,
  FinancialStatus,
  FinancialTransaction,
  FinancialTxType,
  HistoricalWorkRecord,
  SystemSettings,
  UserRole,
} from '../shared/types';

interface MonthlyStatementSectionProps {
  role: UserRole;
  currentShamsiDate: string;
  collaborationStartShamsi?: string | null;
  dailySummaries: DailyAttendanceSummary[];
  historicalRecords: HistoricalWorkRecord[];
  transactions: FinancialTransaction[];
  settings: SystemSettings | null;
  cumulativeBalanceToman?: number;
}

const DEFAULT_FALLBACK_SETTINGS: SystemSettings = {
  id: 1,
  shift_start_time: '07:00',
  shift_end_time: '15:00',
  thursday_shift_start_time: '07:00',
  thursday_shift_end_time: '14:00',
  thursday_overtime_start_time: '14:00',
  grace_period_minutes: 15,
  break_duration_minutes: 0,
  working_days: [6, 0, 1, 2, 3, 4],
  overtime_start_time: '15:00',
  overtime_before_shift: false,
  mission_policy: 'PAID_AS_WORK',
  friday_holiday_policy: 'ALL_OVERTIME',
  official_holidays: [],
  timezone: 'Asia/Tehran',
  base_salary_toman: 25000000,
  hourly_rate_toman: null,
  overtime_calc_mode: 'PERCENTAGE',
  overtime_percentage: 140,
  overtime_rate_toman: null,
  collaboration_start_shamsi: '1405/06/15',
  monthly_leave_quota_days: 2.5,
  sms_enabled: false,
  melipayamak_username: '',
  melipayamak_password: '',
  melipayamak_from_number: '',
  melipayamak_is_flash: false,
  worker_phone_number: '',
  rules_confirmed_by_manager: true,
  effective_from_shamsi: '1400/01/01',
  banner_bg_url: null,
};

const TX_TYPE_LABELS: Record<FinancialTxType, string> = {
  SALARY: 'پرداخت حقوق',
  ADVANCE: 'مساعده',
  ON_ACCOUNT: 'علی‌الحساب',
  OTHER: 'هزینه انجام‌شده برای پرسنل (اسنپ/ابزار)',
  PETTY_CASH: 'تنخواه / خرید کارگاهی پرسنل',
};

const STATUS_LABELS: Record<FinancialStatus, string> = {
  APPROVED: 'تأییدشده',
  PENDING: 'در انتظار تأیید',
  REJECTED: 'ردشده',
};

export function MonthlyStatementSection({
  role,
  currentShamsiDate,
  collaborationStartShamsi,
  dailySummaries,
  historicalRecords,
  transactions,
  settings,
  cumulativeBalanceToman,
}: MonthlyStatementSectionProps) {
  const effectiveSettings = settings || DEFAULT_FALLBACK_SETTINGS;
  const [selectedPeriodKey, setSelectedPeriodKey] = useState<string>('');
  const [activeDetailTab, setActiveDetailTab] = useState<
    'none' | 'transactions' | 'all_months'
  >('none');

  // تولید دوره‌های ماهانه ثابت ۱۵ام به ۱۵ام هر ماه (بر مبنای ماه کاری ۲۶ روزه)
  const generatedPeriods = useMemo(() => {
    return generateStatementPeriods({
      mode: 'CONTRACT_CYCLE',
      cycleStartDay: 15,
      inclusiveEndDay: true,
      currentShamsiDate: currentShamsiDate || '1405/07/15',
      collaborationStartShamsi:
        collaborationStartShamsi || effectiveSettings.collaboration_start_shamsi,
      dailySummaries,
      historicalRecords,
      transactions,
      settings: effectiveSettings,
    });
  }, [
    currentShamsiDate,
    collaborationStartShamsi,
    effectiveSettings,
    dailySummaries,
    historicalRecords,
    transactions,
  ]);

  // محاسبه مجموع کل ماه‌ها (برای نمایش مانده کل در صورتی که از بیرون پاس داده نشده باشد)
  const computedTotalBalanceToman = useMemo(() => {
    if (typeof cumulativeBalanceToman === 'number') {
      return cumulativeBalanceToman;
    }
    return generatedPeriods.reduce((sum, p) => sum + p.periodBalanceToman, 0);
  }, [cumulativeBalanceToman, generatedPeriods]);

  const activeStatement = useMemo<PeriodStatementSummary | null>(() => {
    if (generatedPeriods.length === 0) return null;
    if (selectedPeriodKey) {
      const found = generatedPeriods.find((p) => p.periodKey === selectedPeriodKey);
      if (found) return found;
    }
    const firstWithActivity = generatedPeriods.find(
      (p) =>
        p.salaryPlusOvertimeToman > 0 ||
        p.approvedTotalPaidOrReceivedToman > 0 ||
        p.workDaysCount > 0
    );
    return firstWithActivity || generatedPeriods[0];
  }, [generatedPeriods, selectedPeriodKey]);

  if (!activeStatement) {
    return null;
  }

  const isPeriodCreditor = activeStatement.periodBalanceToman > 0;
  const isPeriodDebtor = activeStatement.periodBalanceToman < 0;

  return (
    <section
      aria-label="صورتحساب ماهانه حقوق، اضافه‌کاری و دریافتی‌ها (۱۵ام به ۱۵ام)"
      className="rounded-2xl bg-white border-2 border-[#C5A059]/70 p-3.5 sm:p-4 space-y-3.5 shadow-xs"
    >
      {/* هدر صورتحساب ماهانه (۱۵ام به ۱۵ام) و انتخابگر ماه */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 border-b border-slate-100 pb-3">
        <div className="flex items-start gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-[#0B192C] text-[#C5A059] border border-[#C5A059]/60 flex items-center justify-center shrink-0">
            <FileSpreadsheet className="w-4 h-4" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-xs sm:text-sm font-extrabold text-[#0B192C]">
                {role === 'worker'
                  ? 'صورتحساب ماهانه (۱۵ام به ۱۵ام) — حقوق + اضافه‌کاری و دریافتی من'
                  : 'صورتحساب ماهانه پرسنل (۱۵ام به ۱۵ام) — حقوق + اضافه‌کاری و پرداختی مدیر'}
              </h3>
              <span className="px-2 py-0.5 rounded-md bg-[#FCF9F2] border border-[#C5A059]/50 text-[10px] font-bold text-[#9A7428]">
                ماه کاری {toPersianDigits(STANDARD_MONTHLY_WORK_DAYS)} روزه
              </span>
            </div>
            <p className="text-[10.5px] text-slate-500 mt-0.5 leading-5">
              محاسبه ماهانه (از ۱۵ام هر ماه تا ۱۵ام ماه بعد) شامل پایه حقوق کامل ماهانه + اضافه‌کاری ثبت‌شده در همان ماه و جمع کل{' '}
              {role === 'worker' ? 'دریافتی شما' : 'پرداختی مدیر'}
            </p>
          </div>
        </div>

        {/* دراپ‌دان انتخاب ماه کاری (۱۵ام به ۱۵ام) */}
        <div className="flex items-center gap-2 bg-[#FCF9F2] border border-[#C5A059]/50 rounded-xl px-2.5 py-1.5 shrink-0 self-start sm:self-center">
          <Calendar className="w-3.5 h-3.5 text-[#9A7428] shrink-0" />
          <label
            htmlFor={`period-select-${role}`}
            className="text-[11px] font-bold text-[#0B192C] whitespace-nowrap"
          >
            انتخاب ماه:
          </label>
          <select
            id={`period-select-${role}`}
            value={activeStatement.periodKey}
            onChange={(e) => setSelectedPeriodKey(e.target.value)}
            className="min-h-[30px] rounded-lg border border-[#C5A059]/60 bg-white px-2 text-[11px] font-extrabold text-[#0B192C] focus:outline-none cursor-pointer"
          >
            {generatedPeriods.map((p) => (
              <option key={p.periodKey} value={p.periodKey}>
                {p.title} ({p.subtitle})
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* نوار کارت‌های سریع ماه‌ها (۱۵ام به ۱۵ام) جهت جابجایی با یک کلیک */}
      {generatedPeriods.length > 1 && (
        <div className="flex items-center gap-2 overflow-x-auto pb-1 pt-0.5">
          {generatedPeriods.slice(0, 6).map((p) => {
            const isSelected = p.periodKey === activeStatement.periodKey;
            return (
              <button
                key={p.periodKey}
                type="button"
                onClick={() => setSelectedPeriodKey(p.periodKey)}
                className={`min-w-[175px] rounded-xl border p-2.5 text-right transition-all shrink-0 cursor-pointer ${
                  isSelected
                    ? 'bg-[#0B192C] text-white border-[#C5A059] shadow-2xs'
                    : 'bg-slate-50 hover:bg-[#FCF9F2] text-[#0B192C] border-slate-200'
                }`}
              >
                <div className="flex items-center justify-between gap-1">
                  <span
                    className={`text-[10.5px] font-extrabold truncate ${
                      isSelected ? 'text-[#C5A059]' : 'text-[#0B192C]'
                    }`}
                  >
                    {p.title}
                  </span>
                </div>
                <div className="mt-1 flex items-center justify-between text-[10px] tabular-nums">
                  <span className={isSelected ? 'text-slate-300' : 'text-slate-500'}>
                    حقوق + اضافه‌کاری:
                  </span>
                  <strong className={isSelected ? 'text-white' : 'text-[#0B192C]'}>
                    {formatToman(p.salaryPlusOvertimeToman)}
                  </strong>
                </div>
                <div className="mt-0.5 flex items-center justify-between text-[9.5px] tabular-nums">
                  <span className={isSelected ? 'text-slate-300' : 'text-slate-500'}>
                    {role === 'worker' ? 'دریافتی ماه:' : 'پرداختی ماه:'}
                  </span>
                  <span
                    className={
                      isSelected ? 'text-[#C5A059]' : 'text-emerald-700 font-semibold'
                    }
                  >
                    {formatToman(p.approvedTotalPaidOrReceivedToman)}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* بنر خلاصه ماه فعال و نرخ‌های مرجع */}
      <div className="rounded-xl bg-gradient-to-l from-[#0B192C] via-[#132847] to-[#0B192C] text-white p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div className="space-y-0.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs sm:text-sm font-extrabold text-[#C5A059]">
              {activeStatement.title}
            </span>
            <span className="text-[10.5px] text-slate-300 tabular-nums">
              ({activeStatement.subtitle})
            </span>
          </div>
          <div className="text-[10px] text-slate-300 tabular-nums flex flex-wrap items-center gap-x-3 gap-y-0.5">
            <span>
              پایه حقوق ماهانه ({toPersianDigits(STANDARD_MONTHLY_WORK_DAYS)} روز کاری):{' '}
              <strong className="text-white">
                {activeStatement.baseSalaryReferenceToman > 0
                  ? formatToman(activeStatement.baseSalaryReferenceToman)
                  : 'تعیین‌نشده'}
              </strong>
            </span>
            <span>·</span>
            <span>
              نرخ هر ساعت عادی:{' '}
              <strong className="text-white">
                {formatToman(activeStatement.effectiveHourlyRateToman)}
              </strong>
            </span>
            <span>·</span>
            <span>
              نرخ هر ساعت اضافه‌کاری:{' '}
              <strong className="text-[#C5A059]">
                {formatToman(activeStatement.effectiveOvertimeHourlyRateToman)}
              </strong>
            </span>
          </div>
        </div>
      </div>

      {/* کارت‌های اصلی صورتحساب ماه انتخاب‌شده */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
        {/* کارت ۱: جمع مبلغ حقوق ماهانه + اضافه‌کاری ماه */}
        <div className="rounded-2xl bg-[#FCF9F2] border-2 border-[#C5A059] p-3 space-y-2">
          <div className="flex items-center justify-between gap-1">
            <span className="text-[11px] font-extrabold text-[#0B192C] flex items-center gap-1">
              <TrendingUp className="w-3.5 h-3.5 text-[#9A7428]" />
              <span>جمع حقوق + اضافه‌کاری این ماه</span>
            </span>
            <span className="text-[9.5px] px-1.5 py-0.5 rounded bg-[#0B192C] text-[#C5A059] font-bold tabular-nums">
              ماهانه
            </span>
          </div>

          <div className="text-sm sm:text-base font-extrabold text-[#0B192C] tabular-nums">
            {formatToman(activeStatement.salaryPlusOvertimeToman)}
          </div>

          {/* ریز جزئیات حقوق ماهانه و اضافه‌کاری در داخل کارت */}
          <div className="pt-2 border-t border-[#C5A059]/35 space-y-1 text-[10.5px] tabular-nums">
            <div className="flex items-center justify-between text-slate-700">
              <span>
                ۱. حقوق ماهانه (ماه کاری {toPersianDigits(STANDARD_MONTHLY_WORK_DAYS)} روزه):
              </span>
              <strong className="text-[#0B192C]">
                {formatToman(activeStatement.earnedRegularSalaryToman)}
              </strong>
            </div>
            <div className="flex items-center justify-between text-[#9A7428]">
              <span>
                ۲. اضافه‌کاری ماه (
                {formatMinutesToDurationPersian(activeStatement.overtimeMinutes)}):
              </span>
              <strong className="font-extrabold">
                {formatToman(activeStatement.earnedOvertimePayToman)}
              </strong>
            </div>
            {activeStatement.approvedPettyCashToman > 0 && (
              <div className="flex items-center justify-between text-emerald-800 pt-1 border-t border-dashed border-[#C5A059]/30">
                <span>+ تنخواه / خرید کارگاهی تأییدشده ماه:</span>
                <strong>{formatToman(activeStatement.approvedPettyCashToman)}</strong>
              </div>
            )}
            {activeStatement.approvedPettyCashToman > 0 && (
              <div className="flex items-center justify-between text-[#0B192C] font-bold">
                <span>جمع کل استحقاقی ماه (با تنخواه):</span>
                <span>{formatToman(activeStatement.totalPeriodEntitlementToman)}</span>
              </div>
            )}
          </div>
        </div>

        {/* کارت ۲: جمع کل دریافتی پرسنل / جمع کل پرداختی مدیر در این ماه */}
        <div className="rounded-2xl bg-slate-50 border border-slate-200 p-3 space-y-2">
          <div className="flex items-center justify-between gap-1">
            <span className="text-[11px] font-extrabold text-[#0B192C] flex items-center gap-1">
              <CreditCard className="w-3.5 h-3.5 text-emerald-700" />
              <span>
                {role === 'worker'
                  ? 'جمع کل دریافتی من در این ماه'
                  : 'جمع کل پرداختی مدیر در این ماه'}
              </span>
            </span>
          </div>

          <div className="text-sm sm:text-base font-extrabold text-emerald-800 tabular-nums">
            {formatToman(activeStatement.approvedTotalPaidOrReceivedToman)}
          </div>

          {/* ریز جزئیات پرداختی‌ها در این ماه */}
          <div className="pt-2 border-t border-slate-200/80 space-y-1 text-[10.5px] tabular-nums">
            <div className="flex items-center justify-between text-slate-600">
              <span>بابت حقوق ماهانه:</span>
              <strong className="text-[#0B192C]">
                {formatToman(activeStatement.salaryPaidToman)}
              </strong>
            </div>
            <div className="flex items-center justify-between text-slate-600">
              <span>بابت مساعده و علی‌الحساب:</span>
              <strong className="text-[#0B192C]">
                {formatToman(activeStatement.advanceAndOnAccountPaidToman)}
              </strong>
            </div>
            {activeStatement.otherPaidForWorkerToman > 0 && (
              <div className="flex items-center justify-between text-slate-600">
                <span>سایر هزینه‌های انجام‌شده برای پرسنل:</span>
                <strong className="text-[#0B192C]">
                  {formatToman(activeStatement.otherPaidForWorkerToman)}
                </strong>
              </div>
            )}
            {activeStatement.pendingCount > 0 && (
              <div className="flex items-center justify-between text-amber-800 pt-1 border-t border-dashed border-slate-200">
                <span>
                  در انتظار تأیید ({toPersianDigits(activeStatement.pendingCount)} مورد):
                </span>
                <strong>{formatToman(activeStatement.pendingAmountToman)}</strong>
              </div>
            )}
          </div>
        </div>

        {/* کارت ۳: مانده صورتحساب این ماه و مانده کل حساب */}
        <div
          className={`rounded-2xl border-2 p-3 space-y-2 ${
            isPeriodCreditor
              ? 'bg-emerald-50/85 border-emerald-500 text-emerald-950'
              : isPeriodDebtor
                ? 'bg-red-50/85 border-red-500 text-red-950'
                : 'bg-slate-50 border-slate-300 text-slate-900'
          }`}
        >
          <div className="flex items-center justify-between gap-1">
            <span className="text-[11px] font-extrabold flex items-center gap-1">
              <Wallet className="w-3.5 h-3.5" />
              <span>مانده تسویه این ماه</span>
            </span>
            <span
              className={`text-[9.5px] px-1.5 py-0.5 rounded font-extrabold ${
                isPeriodCreditor
                  ? 'bg-emerald-600 text-white'
                  : isPeriodDebtor
                    ? 'bg-red-600 text-white'
                    : 'bg-slate-600 text-white'
              }`}
            >
              {isPeriodCreditor
                ? 'طلب پرسنل در این ماه'
                : isPeriodDebtor
                  ? 'اضافه‌دریافت در این ماه'
                  : 'تسویه کامل ماه'}
            </span>
          </div>

          <div className="text-sm sm:text-base font-extrabold tabular-nums">
            {formatToman(Math.abs(activeStatement.periodBalanceToman))}
          </div>

          <div className="pt-2 border-t border-current/15 space-y-1 text-[10.5px] tabular-nums">
            <div className="flex items-center justify-between opacity-90">
              <span>مانده حقوق + اضافه‌کاری این ماه:</span>
              <strong>
                {formatToman(Math.abs(activeStatement.salaryAndOvertimeBalanceToman))}{' '}
                {activeStatement.salaryAndOvertimeBalanceToman > 0
                  ? '(طلب)'
                  : activeStatement.salaryAndOvertimeBalanceToman < 0
                    ? '(اضافه‌دریافت)'
                    : '(تسویه)'}
              </strong>
            </div>
            <div className="flex items-center justify-between pt-1 border-t border-dashed border-current/20">
              <span>مانده کل حساب تا امروز (همه ماه‌ها):</span>
              <strong>
                {formatToman(Math.abs(computedTotalBalanceToman))}{' '}
                {computedTotalBalanceToman > 0
                  ? '(بستانکار کل)'
                  : computedTotalBalanceToman < 0
                    ? '(بدهکار کل)'
                    : '(تسویه)'}
              </strong>
            </div>
          </div>
        </div>
      </div>

      {/* دکمه‌های باز کردن ریز تراکنش‌های ماه و جدول خلاصه همه ماه‌ها */}
      <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-slate-100">
        <button
          type="button"
          onClick={() =>
            setActiveDetailTab((prev) =>
              prev === 'transactions' ? 'none' : 'transactions'
            )
          }
          className={`min-h-[34px] px-3 rounded-xl border text-[11px] font-bold flex items-center gap-1.5 transition-colors cursor-pointer ${
            activeDetailTab === 'transactions'
              ? 'bg-[#0B192C] text-[#C5A059] border-[#C5A059]'
              : 'bg-slate-50 hover:bg-[#FCF9F2] text-[#0B192C] border-slate-200'
          }`}
        >
          <Receipt className="w-3.5 h-3.5 text-emerald-700" />
          <span>
            ریز دریافتی‌ها، پرداختی‌ها و تنخواه این ماه (
            {toPersianDigits(activeStatement.periodTransactions.length)} تراکنش)
          </span>
          {activeDetailTab === 'transactions' ? (
            <ChevronUp className="w-3.5 h-3.5" />
          ) : (
            <ChevronDown className="w-3.5 h-3.5" />
          )}
        </button>

        {generatedPeriods.length > 0 && (
          <button
            type="button"
            onClick={() =>
              setActiveDetailTab((prev) =>
                prev === 'all_months' ? 'none' : 'all_months'
              )
            }
            className={`min-h-[34px] px-3 rounded-xl border text-[11px] font-bold flex items-center gap-1.5 transition-colors cursor-pointer ${
              activeDetailTab === 'all_months'
                ? 'bg-[#0B192C] text-[#C5A059] border-[#C5A059]'
                : 'bg-slate-50 hover:bg-[#FCF9F2] text-[#0B192C] border-slate-200'
            }`}
          >
            <Layers className="w-3.5 h-3.5 text-[#9A7428]" />
            <span>
              جدول خلاصه تمام ماه‌ها (۱۵ام به ۱۵ام —{' '}
              {toPersianDigits(generatedPeriods.length)} ماه)
            </span>
            {activeDetailTab === 'all_months' ? (
              <ChevronUp className="w-3.5 h-3.5" />
            ) : (
              <ChevronDown className="w-3.5 h-3.5" />
            )}
          </button>
        )}
      </div>

      {/* پنل ۱: ریز تراکنش‌های دریافتی پرسنل / پرداختی مدیر و تنخواه در این ماه */}
      {activeDetailTab === 'transactions' && (
        <div className="rounded-xl bg-slate-50 border border-slate-200 p-3 space-y-2 overflow-x-auto">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-extrabold text-[#0B192C]">
              ریز دریافتی‌ها، پرداختی‌های مدیر و تنخواه ثبت‌شده در {activeStatement.title}
            </h4>
            <span className="text-[10.5px] text-emerald-800 font-bold tabular-nums">
              جمع پرداختی مدیر / دریافتی پرسنل:{' '}
              {formatToman(activeStatement.approvedTotalPaidOrReceivedToman)}
            </span>
          </div>

          {activeStatement.periodTransactions.length === 0 ? (
            <p className="text-xs text-slate-500 py-4 text-center">
              در این ماه تراکنش مالی ثبت نشده است.
            </p>
          ) : (
            <table className="w-full text-[11px] text-right border-collapse">
              <thead>
                <tr className="border-b border-slate-200 text-slate-600">
                  <th className="py-1.5 px-2">تاریخ</th>
                  <th className="py-1.5 px-2">نوع تراکنش</th>
                  <th className="py-1.5 px-2">شرح و بابت</th>
                  <th className="py-1.5 px-2">وضعیت</th>
                  <th className="py-1.5 px-2">مبلغ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200/70 tabular-nums">
                {activeStatement.periodTransactions.map((tx) => (
                  <tr key={tx.id} className="hover:bg-white/80">
                    <td className="py-1.5 px-2 font-bold text-[#0B192C]">
                      {toPersianDigits(tx.shamsi_date)}
                    </td>
                    <td className="py-1.5 px-2">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          tx.tx_type === 'PETTY_CASH'
                            ? 'bg-emerald-100 text-emerald-900'
                            : 'bg-slate-200/80 text-[#0B192C]'
                        }`}
                      >
                        {TX_TYPE_LABELS[tx.tx_type]}
                      </span>
                    </td>
                    <td className="py-1.5 px-2 text-slate-700">{tx.description}</td>
                    <td className="py-1.5 px-2">
                      <span
                        className={`font-bold ${
                          tx.status === 'APPROVED'
                            ? 'text-emerald-700'
                            : tx.status === 'REJECTED'
                              ? 'text-red-700'
                              : 'text-amber-700'
                        }`}
                      >
                        {STATUS_LABELS[tx.status]}
                      </span>
                    </td>
                    <td className="py-1.5 px-2 font-extrabold text-[#0B192C]">
                      {formatToman(tx.amount_toman)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* پنل ۲: جدول مقایسه‌ای تمام ماه‌ها (۱۵ام به ۱۵ام) در یک نگاه */}
      {activeDetailTab === 'all_months' && (
        <div className="rounded-xl bg-slate-50 border border-slate-200 p-3 space-y-2 overflow-x-auto">
          <h4 className="text-xs font-extrabold text-[#0B192C]">
            جدول جامع صورتحساب ماهانه (۱۵ام به ۱۵ام هر ماه)
          </h4>
          <table className="w-full text-[11px] text-right border-collapse">
            <thead>
              <tr className="border-b border-slate-200 text-slate-600">
                <th className="py-1.5 px-2">ماه کاری (۱۵ام به ۱۵ام)</th>
                <th className="py-1.5 px-2">حقوق ماهانه</th>
                <th className="py-1.5 px-2">ساعت و مبلغ اضافه‌کاری</th>
                <th className="py-1.5 px-2 text-[#0B192C] font-extrabold">
                  جمع حقوق + اضافه‌کاری ماه
                </th>
                <th className="py-1.5 px-2">تنخواه تأییدشده</th>
                <th className="py-1.5 px-2 text-emerald-800 font-extrabold">
                  {role === 'worker' ? 'جمع دریافتی من' : 'جمع پرداختی مدیر'}
                </th>
                <th className="py-1.5 px-2">مانده همان ماه</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200/70 tabular-nums">
              {generatedPeriods.map((p) => {
                const isActive = p.periodKey === activeStatement.periodKey;
                return (
                  <tr
                    key={p.periodKey}
                    onClick={() => setSelectedPeriodKey(p.periodKey)}
                    className={`cursor-pointer transition-colors ${
                      isActive ? 'bg-[#FCF9F2] font-bold' : 'hover:bg-white'
                    }`}
                  >
                    <td className="py-2 px-2 text-[#0B192C]">
                      <div>{p.title}</div>
                      <div className="text-[9.5px] text-slate-500">{p.subtitle}</div>
                    </td>
                    <td className="py-2 px-2">
                      <div>{formatToman(p.earnedRegularSalaryToman)}</div>
                    </td>
                    <td className="py-2 px-2 text-[#9A7428]">
                      <div>{formatToman(p.earnedOvertimePayToman)}</div>
                      <div className="text-[9.5px] opacity-80">
                        ({formatMinutesToHHMM(p.overtimeMinutes)} ساعت)
                      </div>
                    </td>
                    <td className="py-2 px-2 font-extrabold text-[#0B192C]">
                      {formatToman(p.salaryPlusOvertimeToman)}
                    </td>
                    <td className="py-2 px-2 text-emerald-800">
                      {formatToman(p.approvedPettyCashToman)}
                    </td>
                    <td className="py-2 px-2 font-extrabold text-emerald-800">
                      {formatToman(p.approvedTotalPaidOrReceivedToman)}
                    </td>
                    <td
                      className={`py-2 px-2 font-extrabold ${
                        p.periodBalanceToman > 0
                          ? 'text-emerald-700'
                          : p.periodBalanceToman < 0
                            ? 'text-red-700'
                            : 'text-slate-700'
                      }`}
                    >
                      {formatToman(Math.abs(p.periodBalanceToman))}{' '}
                      <span className="text-[9.5px]">
                        {p.periodBalanceToman > 0
                          ? '(طلب)'
                          : p.periodBalanceToman < 0
                            ? '(اضافه‌دریافت)'
                            : '(تسویه)'}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
