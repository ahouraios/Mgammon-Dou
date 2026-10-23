import React, { useEffect, useRef, useState } from 'react';
import { Calendar, ChevronLeft, ChevronRight, X } from 'lucide-react';
import {
  formatShamsiVerbose,
  getShamsiMonthCalendar,
  isValidShamsiDate,
  pad2,
  PERSIAN_MONTHS,
  toEnglishDigits,
  toPersianDigits,
} from '../shared/jalali';

interface ShamsiDatePickerProps {
  value: string;
  onChange: (shamsiDate: string) => void;
  label?: string;
  placeholder?: string;
  required?: boolean;
  allowClear?: boolean;
  todayShamsi?: string;
}

const WEEKDAY_SHORT = ['ش', 'ی', 'د', 'س', 'چ', 'پ', 'ج'];

function parseInitialShamsi(val: string, fallback = '1405/07/30'): { jy: number; jm: number; jd: number } {
  const clean = toEnglishDigits(val || fallback).trim().replace(/-/g, '/');
  const parts = clean.split('/').map(Number);
  if (parts.length === 3 && !Number.isNaN(parts[0]) && parts[0] >= 1350 && parts[0] <= 1450) {
    return {
      jy: parts[0],
      jm: Math.min(12, Math.max(1, parts[1] || 1)),
      jd: Math.min(31, Math.max(1, parts[2] || 1)),
    };
  }
  return { jy: 1405, jm: 7, jd: 30 };
}

export const ShamsiDatePicker: React.FC<ShamsiDatePickerProps> = ({
  value,
  onChange,
  label,
  placeholder = 'انتخاب تاریخ',
  allowClear = false,
  todayShamsi = '1405/07/30',
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const parsed = parseInitialShamsi(value || todayShamsi, todayShamsi);
  const [viewYear, setViewYear] = useState(parsed.jy);
  const [viewMonth, setViewMonth] = useState(parsed.jm);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (value && isValidShamsiDate(value)) {
      const p = parseInitialShamsi(value, todayShamsi);
      setViewYear(p.jy);
      setViewMonth(p.jm);
    }
  }, [value, todayShamsi]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  const { monthLength, startDayOffset } = getShamsiMonthCalendar(viewYear, viewMonth);

  const handlePrevMonth = () => {
    if (viewMonth === 1) {
      setViewMonth(12);
      setViewYear((y) => y - 1);
    } else {
      setViewMonth((m) => m - 1);
    }
  };

  const handleNextMonth = () => {
    if (viewMonth === 12) {
      setViewMonth(1);
      setViewYear((y) => y + 1);
    } else {
      setViewMonth((m) => m + 1);
    }
  };

  const handleSelectDay = (day: number) => {
    const formatted = `${viewYear}/${pad2(viewMonth)}/${pad2(day)}`;
    onChange(formatted);
    setIsOpen(false);
  };

  const handleSelectToday = () => {
    onChange(todayShamsi);
    const p = parseInitialShamsi(todayShamsi);
    setViewYear(p.jy);
    setViewMonth(p.jm);
    setIsOpen(false);
  };

  const daysArray = Array.from({ length: monthLength }, (_, i) => i + 1);
  const emptyCells = Array.from({ length: startDayOffset }, (_, i) => i);

  return (
    <div ref={containerRef} className="relative w-full">
      {label && (
        <label className="block text-xs font-medium text-slate-700 mb-1.5">
          {label}
        </label>
      )}

      <div className="relative flex items-center">
        <button
          type="button"
          onClick={() => setIsOpen((prev) => !prev)}
          className="w-full min-h-[44px] rounded-xl border border-slate-200 hover:border-[#C5A059] focus:border-[#0B192C] bg-white px-3.5 py-2 text-xs text-right flex items-center justify-between gap-2 transition-colors cursor-pointer"
        >
          <span className={value ? 'font-bold text-[#0B192C] tabular-nums' : 'text-slate-400'}>
            {value ? `${toPersianDigits(value)} (${formatShamsiVerbose(value)})` : placeholder}
          </span>
          <Calendar className="w-4 h-4 text-[#C5A059] shrink-0" />
        </button>

        {allowClear && value && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onChange('');
            }}
            title="پاک کردن تاریخ"
            className="absolute left-9 p-1 text-slate-400 hover:text-red-600 cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {isOpen && (
        <div className="absolute z-50 mt-1.5 right-0 w-72 sm:w-80 rounded-2xl bg-white border border-[#C5A059]/60 shadow-xl p-4 select-none">
          {/* هدر انتخاب سال و ماه شمسی */}
          <div className="flex items-center justify-between gap-1 pb-3 border-b border-slate-100">
            <button
              type="button"
              onClick={handlePrevMonth}
              className="w-8 h-8 rounded-lg border border-slate-200 hover:border-[#C5A059] flex items-center justify-center text-[#0B192C] cursor-pointer"
              title="ماه قبل"
            >
              <ChevronRight className="w-4 h-4" />
            </button>

            <div className="flex items-center gap-1.5">
              <select
                value={viewMonth}
                onChange={(e) => setViewMonth(Number(e.target.value))}
                className="rounded-lg border border-slate-200 px-2 py-1 text-xs font-bold text-[#0B192C] bg-slate-50 focus:outline-none"
              >
                {PERSIAN_MONTHS.map((mName, idx) => (
                  <option key={mName} value={idx + 1}>
                    {mName}
                  </option>
                ))}
              </select>

              <select
                value={viewYear}
                onChange={(e) => setViewYear(Number(e.target.value))}
                className="rounded-lg border border-slate-200 px-2 py-1 text-xs font-bold text-[#0B192C] bg-slate-50 tabular-nums focus:outline-none"
              >
                {Array.from({ length: 15 }, (_, i) => 1398 + i).map((yr) => (
                  <option key={yr} value={yr}>
                    {toPersianDigits(yr)}
                  </option>
                ))}
              </select>
            </div>

            <button
              type="button"
              onClick={handleNextMonth}
              className="w-8 h-8 rounded-lg border border-slate-200 hover:border-[#C5A059] flex items-center justify-center text-[#0B192C] cursor-pointer"
              title="ماه بعد"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
          </div>

          {/* سرستون روزهای هفته */}
          <div className="grid grid-cols-7 gap-1 text-center mt-2.5 mb-1">
            {WEEKDAY_SHORT.map((w, idx) => (
              <div
                key={w}
                className={`text-[11px] font-bold py-1 ${
                  idx === 6 ? 'text-rose-600' : 'text-slate-500'
                }`}
              >
                {w}
              </div>
            ))}
          </div>

          {/* شبکه روزهای ماه شمسی */}
          <div className="grid grid-cols-7 gap-1">
            {emptyCells.map((c) => (
              <div key={`empty-${c}`} className="h-8" />
            ))}
            {daysArray.map((day) => {
              const candidate = `${viewYear}/${pad2(viewMonth)}/${pad2(day)}`;
              const isSelected = value === candidate;
              const isToday = todayShamsi === candidate;
              const isFriday = (startDayOffset + day - 1) % 7 === 6;

              return (
                <button
                  key={day}
                  type="button"
                  onClick={() => handleSelectDay(day)}
                  className={`h-8 rounded-lg text-xs tabular-nums font-medium flex items-center justify-center transition-colors cursor-pointer ${
                    isSelected
                      ? 'bg-[#0B192C] text-[#C5A059] border border-[#C5A059] font-bold shadow-xs'
                      : isToday
                        ? 'border border-[#C5A059] text-[#0B192C] font-bold bg-[#C5A059]/10'
                        : isFriday
                          ? 'text-rose-600 hover:bg-rose-50'
                          : 'text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  {toPersianDigits(day)}
                </button>
              );
            })}
          </div>

          {/* دکمه‌های پایین تقویم */}
          <div className="mt-3 pt-2.5 border-t border-slate-100 flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={handleSelectToday}
              className="px-3 py-1.5 rounded-lg bg-[#0B192C] text-[#C5A059] text-[11px] font-semibold hover:bg-[#162a45] transition-colors cursor-pointer"
            >
              انتخاب امروز ({toPersianDigits(todayShamsi)})
            </button>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="px-3 py-1.5 rounded-lg text-[11px] font-medium text-slate-500 hover:bg-slate-100 cursor-pointer"
            >
              بستن
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
