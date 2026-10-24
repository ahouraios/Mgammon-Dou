import React, { useEffect, useRef, useState } from 'react';
import { Calendar, Clock, ChevronDown } from 'lucide-react';
import {
  formatShamsiVerbose,
  getNowInTimezone,
  getShamsiDayOfWeekName,
  getShamsiMonthCalendar,
  isValidShamsiDate,
  normalizeShamsiDate,
  PERSIAN_MONTHS,
  toEnglishDigits,
  toPersianDigits,
} from '../shared/jalali';

interface TopShamsiCalendarBarProps {
  serverShamsiDate?: string;
}

const WEEKDAY_SHORT = ['ش', 'ی', 'د', 'س', 'چ', 'پ', 'ج'];

export const TopShamsiCalendarBar: React.FC<TopShamsiCalendarBarProps> = ({
  serverShamsiDate,
}) => {
  const [nowInfo, setNowInfo] = useState(() => getNowInTimezone('Asia/Tehran'));
  const [openMiniCal, setOpenMiniCal] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const timer = setInterval(() => {
      setNowInfo(getNowInTimezone('Asia/Tehran'));
    }, 30000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpenMiniCal(false);
      }
    }
    if (openMiniCal) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [openMiniCal]);

  const activeShamsi =
    nowInfo.shamsiDate && isValidShamsiDate(nowInfo.shamsiDate)
      ? normalizeShamsiDate(nowInfo.shamsiDate)
      : serverShamsiDate && isValidShamsiDate(serverShamsiDate)
        ? normalizeShamsiDate(serverShamsiDate)
        : '1405/08/02';

  const dayOfWeekName = getShamsiDayOfWeekName(activeShamsi) || nowInfo.dayNamePersian || 'شنبه';
  const verboseDate = formatShamsiVerbose(activeShamsi);
  const numericDatePersian = toPersianDigits(activeShamsi);
  const timePersian = toPersianDigits(nowInfo.timeHHMM || '12:00');

  const [jy, jm, jd] = toEnglishDigits(activeShamsi).split('/').map(Number);
  const { monthLength, startDayOffset } = getShamsiMonthCalendar(jy || 1405, jm || 8);
  const monthName = PERSIAN_MONTHS[(jm || 8) - 1] || '';

  const cells: (number | null)[] = [];
  for (let i = 0; i < startDayOffset; i++) {
    cells.push(null);
  }
  for (let d = 1; d <= monthLength; d++) {
    cells.push(d);
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpenMiniCal((prev) => !prev)}
        title="مشاهده تقویم ماه جاری"
        className="min-h-[38px] px-2.5 sm:px-3 py-1.5 rounded-xl bg-[#F8FAFC] hover:bg-[#0B192C]/5 border border-[#C5A059]/55 text-[#0B192C] flex items-center gap-1.5 sm:gap-2 transition-colors cursor-pointer"
      >
        <span className="w-6 h-6 rounded-lg bg-[#0B192C] text-[#C5A059] flex items-center justify-center shrink-0">
          <Calendar className="w-3.5 h-3.5" />
        </span>
        <div className="flex items-center gap-1.5 text-right leading-none">
          <span className="text-[11px] sm:text-xs font-extrabold text-[#0B192C]">
            {dayOfWeekName}
          </span>
          <span className="text-[#C5A059] font-bold">،</span>
          <span className="text-[11px] sm:text-xs font-bold text-slate-700">
            {verboseDate}
          </span>
          <span className="hidden md:inline-block text-[10px] font-semibold text-slate-500 tabular-nums bg-white px-1.5 py-0.5 rounded-md border border-slate-200">
            {numericDatePersian}
          </span>
        </div>
        <div className="hidden sm:flex items-center gap-1 pr-1.5 border-r border-[#C5A059]/40 text-[11px] font-bold text-[#0B192C] tabular-nums">
          <Clock className="w-3 h-3 text-[#C5A059]" />
          <span>{timePersian}</span>
        </div>
        <ChevronDown
          className={`w-3.5 h-3.5 text-slate-500 transition-transform ${
            openMiniCal ? 'rotate-180 text-[#0B192C]' : ''
          }`}
        />
      </button>

      {openMiniCal && (
        <div className="absolute left-0 sm:right-0 sm:left-auto mt-2 w-64 rounded-2xl bg-white border border-[#C5A059] shadow-xl p-3.5 z-50 text-[#0B192C]">
          <div className="flex items-center justify-between pb-2.5 mb-2.5 border-b border-slate-100">
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-[#C5A059]" />
              <span className="text-xs font-extrabold text-[#0B192C]">
                {monthName} {toPersianDigits(jy)}
              </span>
            </div>
            <span className="text-[11px] font-bold text-slate-500 tabular-nums">
              {numericDatePersian}
            </span>
          </div>

          <div className="grid grid-cols-7 gap-1 text-center mb-1.5">
            {WEEKDAY_SHORT.map((w, idx) => (
              <div
                key={w}
                className={`text-[10px] font-extrabold py-0.5 ${
                  idx === 6 ? 'text-red-600' : 'text-slate-500'
                }`}
              >
                {w}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-1 text-center">
            {cells.map((dayNum, index) => {
              if (dayNum === null) {
                return <div key={`empty-${index}`} className="h-7" />;
              }
              const isToday = dayNum === jd;
              const isFriday = index % 7 === 6;
              return (
                <div
                  key={dayNum}
                  className={`h-7 rounded-lg flex items-center justify-center text-xs tabular-nums select-none ${
                    isToday
                      ? 'bg-[#0B192C] text-[#C5A059] font-extrabold border border-[#C5A059]'
                      : isFriday
                        ? 'text-red-600 font-bold bg-red-50/50'
                        : 'text-slate-700 font-semibold hover:bg-slate-100'
                  }`}
                >
                  {toPersianDigits(dayNum)}
                </div>
              );
            })}
          </div>

          <div className="mt-3 pt-2 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-600">
            <span>امروز: {dayOfWeekName}</span>
            <span className="font-bold text-[#0B192C] tabular-nums">ساعت {timePersian}</span>
          </div>
        </div>
      )}
    </div>
  );
};
