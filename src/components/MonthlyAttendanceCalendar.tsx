import React, { useMemo, useState } from 'react';
import {
  DailyAttendanceSummary,
  HistoricalWorkRecord,
  LeaveRequestItem,
} from '../shared/types';
import {
  formatDurationPersian,
  getShamsiDayOfWeekName,
  getShamsiMonthDays,
  isValidShamsiDate,
  normalizeShamsiDate,
  SHAMSI_MONTH_NAMES,
  shamsiToGregorian,
  toPersianDigits,
} from '../shared/jalali';
import { ChevronRight, ChevronLeft, Calendar, X, Clock } from 'lucide-react';

interface MonthlyAttendanceCalendarProps {
  currentShamsiDate: string;
  dailySummaries: DailyAttendanceSummary[];
  leaveRequests: LeaveRequestItem[];
  historicalRecords?: HistoricalWorkRecord[];
  onMonthChange?: (year: number, month: number) => void;
}

function inferTimesFromHistoricalRow(
  _shamsiDate: string,
  netMins: number,
  otMins: number,
  note?: string,
  explicitIn?: string,
  explicitOut?: string
): { firstIn: string; lastOut: string } {
  if (explicitIn && explicitOut) {
    return { firstIn: explicitIn, lastOut: explicitOut };
  }
  const noteStr = note || '';
  if (noteStr.includes('۰۸:۰۰') && noteStr.includes('۱۴:۳۰')) {
    return { firstIn: '08:00', lastOut: '14:30' };
  }
  const startMinutes =
    netMins > 0 && netMins <= 480 ? 7 * 60 + (480 - netMins) : 7 * 60;
  const inH = Math.floor(startMinutes / 60);
  const inM = startMinutes % 60;
  const firstIn =
    explicitIn ||
    `${String(inH).padStart(2, '0')}:${String(inM).padStart(2, '0')}`;

  const endMinutes = 15 * 60 + Math.max(0, otMins);
  const outH = Math.floor(endMinutes / 60);
  const outM = endMinutes % 60;
  const lastOut =
    explicitOut ||
    `${String(outH).padStart(2, '0')}:${String(outM).padStart(2, '0')}`;

  return { firstIn, lastOut };
}

export const MonthlyAttendanceCalendar: React.FC<MonthlyAttendanceCalendarProps> = ({
  currentShamsiDate,
  dailySummaries,
  leaveRequests,
  historicalRecords = [],
  onMonthChange,
}) => {
  const initialParts = useMemo(() => {
    const parts = (currentShamsiDate || '1405/08/01').split('/').map(Number);
    return {
      year: parts[0] || 1405,
      month: parts[1] || 8,
    };
  }, [currentShamsiDate]);

  const [viewYear, setViewYear] = useState(initialParts.year);
  const [viewMonth, setViewMonth] = useState(initialParts.month);
  const [selectedDayShamsi, setSelectedDayShamsi] = useState<string | null>(null);

  const summaryMap = useMemo(() => {
    const map = new Map<string, DailyAttendanceSummary>();

    // ۱. ابتدا سوابق تأییدشده یا بارگذاری‌شده از اکسل را در نقشه روزانه قرار می‌دهیم
    for (const rec of historicalRecords) {
      if (rec.status === 'REJECTED') continue;
      if (rec.parsed_rows && rec.parsed_rows.length > 0) {
        for (const row of rec.parsed_rows) {
          if (!row.shamsi_date || !isValidShamsiDate(row.shamsi_date)) continue;
          const normShamsi = normalizeShamsiDate(row.shamsi_date);
          const workDate = shamsiToGregorian(normShamsi);
          const dayName = getShamsiDayOfWeekName(normShamsi);
          const isMission = Boolean(row.note && row.note.includes('مأموریت'));
          const { firstIn, lastOut } = inferTimesFromHistoricalRow(
            normShamsi,
            row.net_work_minutes,
            row.overtime_minutes,
            row.note,
            row.check_in,
            row.check_out
          );
          map.set(normShamsi, {
            work_date: workDate,
            shamsi_date: normShamsi,
            day_name: dayName,
            is_holiday_or_friday: dayName === 'جمعه',
            is_working_day: dayName !== 'جمعه',
            logs: [],
            first_in_time: firstIn,
            last_out_time: lastOut,
            is_incomplete: false,
            is_late: row.net_work_minutes > 0 && row.net_work_minutes < 480 && dayName !== 'جمعه',
            late_minutes:
              row.net_work_minutes > 0 && row.net_work_minutes < 480 && dayName !== 'جمعه'
                ? 480 - row.net_work_minutes
                : 0,
            gross_presence_minutes: row.net_work_minutes + row.overtime_minutes,
            mission_minutes: isMission ? 60 : 0,
            break_deducted_minutes: 0,
            net_work_minutes: row.net_work_minutes,
            provisional_work_minutes: row.net_work_minutes,
            overtime_minutes: row.overtime_minutes,
            status_label: row.note || row.title || 'ثبت‌شده در سوابق کارکرد',
          });
        }
      } else if (rec.work_days_count === 1 && isValidShamsiDate(rec.shamsi_date)) {
        const normShamsi = normalizeShamsiDate(rec.shamsi_date);
        const workDate = shamsiToGregorian(normShamsi);
        const dayName = getShamsiDayOfWeekName(normShamsi);
        const { firstIn, lastOut } = inferTimesFromHistoricalRow(
          normShamsi,
          rec.net_work_minutes,
          rec.overtime_minutes,
          rec.note || undefined
        );
        map.set(normShamsi, {
          work_date: workDate,
          shamsi_date: normShamsi,
          day_name: dayName,
          is_holiday_or_friday: dayName === 'جمعه',
          is_working_day: dayName !== 'جمعه',
          logs: [],
          first_in_time: firstIn,
          last_out_time: lastOut,
          is_incomplete: false,
          is_late: false,
          late_minutes: 0,
          gross_presence_minutes: rec.net_work_minutes + rec.overtime_minutes,
          mission_minutes: 0,
          break_deducted_minutes: 0,
          net_work_minutes: rec.net_work_minutes,
          provisional_work_minutes: rec.net_work_minutes,
          overtime_minutes: rec.overtime_minutes,
          status_label: rec.note || rec.title,
        });
      }
    }

    // ۲. خلاصه‌های روزانه و ترددهای ثبت‌شده مستقیم را جایگزین/تکمیل می‌کنیم
    for (const s of dailySummaries) {
      const normShamsi = normalizeShamsiDate(s.shamsi_date);
      map.set(normShamsi, s);
    }

    return map;
  }, [dailySummaries, historicalRecords]);

  // استخراج ماه‌های دارای سابقه + ماه در حال مشاهده برای نمایش در دراپ‌دان کم‌حجم
  const availableMonths = useMemo(() => {
    const countsByMonth = new Map<string, { year: number; month: number; count: number }>();
    const curPrefix = `${initialParts.year}/${String(initialParts.month).padStart(2, '0')}`;
    countsByMonth.set(curPrefix, {
      year: initialParts.year,
      month: initialParts.month,
      count: 0,
    });

    const viewPrefix = `${viewYear}/${String(viewMonth).padStart(2, '0')}`;
    if (!countsByMonth.has(viewPrefix)) {
      countsByMonth.set(viewPrefix, {
        year: viewYear,
        month: viewMonth,
        count: 0,
      });
    }

    for (const [shamsiDate, sum] of summaryMap.entries()) {
      const hasWork =
        sum.logs.length > 0 || sum.net_work_minutes > 0 || sum.overtime_minutes > 0;
      if (!hasWork) continue;
      const parts = shamsiDate.split('/').map(Number);
      if (parts.length >= 2 && parts[0] && parts[1]) {
        const key = `${parts[0]}/${String(parts[1]).padStart(2, '0')}`;
        const existing = countsByMonth.get(key) || {
          year: parts[0],
          month: parts[1],
          count: 0,
        };
        existing.count += 1;
        countsByMonth.set(key, existing);
      }
    }

    return Array.from(countsByMonth.values()).sort((a, b) =>
      a.year !== b.year ? b.year - a.year : b.month - a.month
    );
  }, [summaryMap, initialParts, viewYear, viewMonth]);

  // آمار تجمیعی ماه در حال مشاهده
  const currentMonthStats = useMemo(() => {
    const prefix = `${viewYear}/${String(viewMonth).padStart(2, '0')}/`;
    let days = 0;
    let netMins = 0;
    let otMins = 0;
    for (const [shamsiDate, sum] of summaryMap.entries()) {
      if (shamsiDate.startsWith(prefix)) {
        if (sum.logs.length > 0 || sum.net_work_minutes > 0 || sum.overtime_minutes > 0) {
          days += 1;
          netMins += sum.net_work_minutes;
          otMins += sum.overtime_minutes;
        }
      }
    }
    return { days, netMins, otMins };
  }, [summaryMap, viewYear, viewMonth]);

  const approvedLeaveMap = useMemo(() => {
    const map = new Map<string, LeaveRequestItem[]>();
    for (const l of leaveRequests) {
      if (l.status === 'APPROVED') {
        const list = map.get(l.shamsi_date) || [];
        list.push(l);
        map.set(l.shamsi_date, list);
      }
    }
    return map;
  }, [leaveRequests]);

  const daysInMonth = getShamsiMonthDays(viewYear, viewMonth);

  const firstDayOffset = useMemo(() => {
    const firstShamsi = `${viewYear}/${String(viewMonth).padStart(2, '0')}/01`;
    const greg = shamsiToGregorian(firstShamsi);
    const jsDay = new Date(`${greg}T12:00:00Z`).getUTCDay(); // 6=Sat -> 0
    return (jsDay + 1) % 7;
  }, [viewYear, viewMonth]);

  const selectMonthYear = (nextY: number, nextM: number) => {
    setSelectedDayShamsi(null);
    setViewYear(nextY);
    setViewMonth(nextM);
    onMonthChange?.(nextY, nextM);
  };

  const handlePrevMonth = () => {
    if (viewMonth === 1) {
      selectMonthYear(viewYear - 1, 12);
    } else {
      selectMonthYear(viewYear, viewMonth - 1);
    }
  };

  const handleNextMonth = () => {
    if (viewMonth === 12) {
      selectMonthYear(viewYear + 1, 1);
    } else {
      selectMonthYear(viewYear, viewMonth + 1);
    }
  };

  const selectedSummary = selectedDayShamsi ? summaryMap.get(selectedDayShamsi) : undefined;
  const selectedLeaves = selectedDayShamsi ? approvedLeaveMap.get(selectedDayShamsi) || [] : [];
  const selectedHasWork = Boolean(
    selectedSummary &&
      (selectedSummary.logs.length > 0 ||
        selectedSummary.net_work_minutes > 0 ||
        selectedSummary.overtime_minutes > 0)
  );

  return (
    <div className="rounded-2xl bg-white border border-[#C5A059]/45 p-3.5 space-y-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <Calendar className="w-3.5 h-3.5 text-[#C5A059]" />
          <h3 className="text-xs font-bold text-[#0B192C]">
            تقویم کارکرد ماهانه
          </h3>
        </div>

        {/* دراپ‌دان کم‌حجم انتخاب ماه و دکمه‌های قبل/بعد */}
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={handlePrevMonth}
            className="p-1 rounded-lg border border-slate-200 hover:border-[#C5A059] text-[#0B192C] cursor-pointer"
            title="ماه قبل"
          >
            <ChevronRight className="w-3.5 h-3.5" />
          </button>

          <select
            aria-label="انتخاب ماه تقویم"
            value={`${viewYear}-${viewMonth}`}
            onChange={(e) => {
              const [y, m] = e.target.value.split('-').map(Number);
              if (y && m) selectMonthYear(y, m);
            }}
            className="min-h-[30px] rounded-lg border border-[#C5A059]/60 bg-[#FCF9F2] px-2 text-[11px] font-bold text-[#0B192C] focus:outline-none cursor-pointer"
          >
            {availableMonths.map((m) => (
              <option key={`${m.year}-${m.month}`} value={`${m.year}-${m.month}`}>
                {SHAMSI_MONTH_NAMES[m.month - 1]} {toPersianDigits(m.year)}
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={handleNextMonth}
            className="p-1 rounded-lg border border-slate-200 hover:border-[#C5A059] text-[#0B192C] cursor-pointer"
            title="ماه بعد"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* خلاصه کارکرد ماه انتخاب‌شده */}
      <div className="rounded-xl bg-[#FCF9F2] border border-[#C5A059]/40 px-2.5 py-1.5 flex flex-wrap items-center justify-between gap-2 text-[10.5px]">
        <span className="font-bold text-[#0B192C]">
          جمع {SHAMSI_MONTH_NAMES[viewMonth - 1]} {toPersianDigits(viewYear)}:{' '}
          {toPersianDigits(currentMonthStats.days)} روز کاری
        </span>
        <div className="flex flex-wrap items-center gap-2 text-slate-700 tabular-nums">
          <span>
            کارکرد: <strong>{formatDurationPersian(currentMonthStats.netMins)}</strong>
          </span>
          <span>·</span>
          <span className="text-[#9A7428]">
            اضافه‌کاری: <strong>{formatDurationPersian(currentMonthStats.otMins)}</strong>
          </span>
        </div>
      </div>

      {/* راهنمای رنگ‌ها */}
      <div className="flex flex-wrap items-center gap-2.5 text-[9.5px] text-slate-600 pb-1 border-b border-slate-100">
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-xs bg-emerald-500 inline-block" />
          حضور کامل
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-xs bg-[#C5A059] inline-block" />
          اضافه‌کاری
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-xs bg-sky-500 inline-block" />
          مرخصی / مأموریت
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-xs bg-red-500 inline-block" />
          ناقص
        </span>
      </div>

      {/* سرستون روزهای هفته */}
      <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-bold text-slate-500">
        <div>ش</div>
        <div>ی</div>
        <div>د</div>
        <div>س</div>
        <div>چ</div>
        <div>پ</div>
        <div className="text-red-500">ج</div>
      </div>

      {/* ماتریس ۳۰ روزه */}
      <div className="grid grid-cols-7 gap-1">
        {Array.from({ length: firstDayOffset }).map((_, idx) => (
          <div key={`empty-${idx}`} className="h-8 sm:h-9 rounded-lg bg-slate-50/50" />
        ))}

        {Array.from({ length: daysInMonth }).map((_, idx) => {
          const dayNum = idx + 1;
          const shamsiStr = `${viewYear}/${String(viewMonth).padStart(2, '0')}/${String(dayNum).padStart(2, '0')}`;
          const sum = summaryMap.get(shamsiStr);
          const leaves = approvedLeaveMap.get(shamsiStr) || [];
          const isFriday = (firstDayOffset + idx) % 7 === 6;
          const isToday = shamsiStr === currentShamsiDate;
          const hasWork = Boolean(
            sum && (sum.logs.length > 0 || sum.net_work_minutes > 0 || sum.overtime_minutes > 0)
          );

          let bgClass = 'bg-slate-50 text-slate-700 border-slate-200';
          let dotColor = '';

          if (hasWork && sum) {
            if (sum.is_incomplete) {
              bgClass = 'bg-red-50 text-red-900 border-red-300 font-bold';
              dotColor = 'bg-red-500';
            } else if (sum.mission_minutes > 0 || sum.status_label.includes('مأموریت')) {
              bgClass = 'bg-sky-50 text-sky-900 border-sky-300 font-bold';
              dotColor = 'bg-sky-500';
            } else if (sum.overtime_minutes > 0) {
              bgClass = 'bg-[#FCF9F2] text-[#0B192C] border-[#C5A059] font-bold';
              dotColor = 'bg-[#C5A059]';
            } else {
              bgClass = 'bg-emerald-50 text-emerald-900 border-emerald-300 font-bold';
              dotColor = 'bg-emerald-500';
            }
          } else if (leaves.length > 0) {
            bgClass = 'bg-sky-50 text-sky-900 border-sky-300 font-bold';
            dotColor = 'bg-sky-500';
          } else if (isFriday) {
            bgClass = 'bg-slate-100/70 text-slate-400 border-slate-200/60';
          }

          return (
            <button
              key={shamsiStr}
              type="button"
              onClick={() => setSelectedDayShamsi(shamsiStr)}
              className={`h-8 sm:h-9 rounded-lg border text-[11px] flex flex-col items-center justify-center relative transition-all cursor-pointer ${bgClass} ${
                isToday ? 'ring-1.5 ring-[#0B192C]' : ''
              } ${selectedDayShamsi === shamsiStr ? 'scale-95 ring-2 ring-[#C5A059]' : ''}`}
            >
              <span>{toPersianDigits(dayNum)}</span>
              {dotColor && <span className={`w-1 h-1 rounded-full mt-0.5 ${dotColor}`} />}
            </button>
          );
        })}
      </div>

      {/* نمایش جزئیات روز انتخاب‌شده */}
      {selectedDayShamsi && (
        <div className="mt-1.5 rounded-xl bg-[#FCF9F2] border border-[#C5A059] p-3 space-y-1.5">
          <div className="flex items-center justify-between">
            <div className="text-[11px] font-bold text-[#0B192C]">
              جزئیات کارکرد روز {toPersianDigits(selectedDayShamsi)}
            </div>
            <button
              type="button"
              onClick={() => setSelectedDayShamsi(null)}
              className="p-0.5 text-slate-500 hover:text-[#0B192C] cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          {selectedHasWork && selectedSummary ? (
            <div className="space-y-1 text-[11px]">
              <div className="flex flex-wrap items-center gap-2 text-slate-700">
                <span>
                  ورود: <strong>{toPersianDigits(selectedSummary.first_in_time || '07:00')}</strong>
                </span>
                <span>·</span>
                <span>
                  خروج: <strong>{toPersianDigits(selectedSummary.last_out_time || 'ثبت نشده')}</strong>
                </span>
                <span>·</span>
                <span>
                  کارکرد خالص: <strong>{formatDurationPersian(selectedSummary.net_work_minutes)}</strong>
                </span>
                {selectedSummary.overtime_minutes > 0 && (
                  <>
                    <span>·</span>
                    <span className="text-[#9A7428] font-bold">
                      اضافه‌کاری: {formatDurationPersian(selectedSummary.overtime_minutes)}
                    </span>
                  </>
                )}
              </div>
              <div className="text-[10.5px] text-slate-600 flex items-center gap-1">
                <Clock className="w-3 h-3 text-[#C5A059]" />
                <span>شرح / وضعیت: {toPersianDigits(selectedSummary.status_label)}</span>
              </div>
            </div>
          ) : selectedLeaves.length > 0 ? (
            <div className="space-y-1 text-[11px] text-sky-900">
              {selectedLeaves.map((lv) => (
                <div key={lv.id}>
                  مرخصی{' '}
                  {lv.leave_type === 'HOURLY'
                    ? `ساعتی (${toPersianDigits(lv.start_time || '')} تا ${toPersianDigits(lv.end_time || '')})`
                    : 'روزانه'}{' '}
                  — علت: {lv.reason}
                </div>
              ))}
            </div>
          ) : (
            <div className="text-[11px] text-slate-500">
              تردد یا مرخصی ثبت‌شده‌ای برای این تاریخ وجود ندارد.
            </div>
          )}
        </div>
      )}
    </div>
  );
};

