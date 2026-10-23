import React, { useEffect, useRef, useState } from 'react';
import { Clock, ChevronUp, ChevronDown, Check } from 'lucide-react';
import { pad2, toEnglishDigits, toPersianDigits } from '../shared/jalali';

interface TimePickerInputProps {
  value: string; // HH:MM
  onChange: (newTime: string) => void;
  label?: string;
  placeholder?: string;
}

const QUICK_TIMES = ['07:00', '08:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00'];

function parseHHMM(val: string): { hour: number; minute: number } {
  const clean = toEnglishDigits(val || '07:00').trim();
  const parts = clean.split(':').map(Number);
  const hour = Number.isFinite(parts[0]) ? Math.min(23, Math.max(0, parts[0])) : 7;
  const minute = Number.isFinite(parts[1]) ? Math.min(59, Math.max(0, parts[1])) : 0;
  return { hour, minute };
}

export const TimePickerInput: React.FC<TimePickerInputProps> = ({
  value,
  onChange,
  label,
  placeholder = 'انتخاب ساعت',
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const parsed = parseHHMM(value);
  const [hour, setHour] = useState(parsed.hour);
  const [minute, setMinute] = useState(parsed.minute);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const p = parseHHMM(value);
    setHour(p.hour);
    setMinute(p.minute);
  }, [value]);

  useEffect(() => {
    const handleOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleOutside);
    }
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [isOpen]);

  const applyTime = (h: number, m: number) => {
    const formatted = `${pad2(h)}:${pad2(m)}`;
    onChange(formatted);
    setIsOpen(false);
  };

  const adjustHour = (delta: number) => {
    setHour((prev) => (prev + delta + 24) % 24);
  };

  const adjustMinute = (delta: number) => {
    setMinute((prev) => (prev + delta + 60) % 60);
  };

  return (
    <div ref={containerRef} className="relative w-full">
      {label && (
        <label className="block text-xs font-medium text-slate-700 mb-1.5">
          {label}
        </label>
      )}

      <button
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        className="w-full min-h-[44px] rounded-xl border border-slate-200 hover:border-[#C5A059] focus:border-[#0B192C] bg-white px-3.5 py-2 text-xs text-right flex items-center justify-between gap-2 transition-colors cursor-pointer"
      >
        <span className={value ? 'font-bold text-[#0B192C] tabular-nums text-sm' : 'text-slate-400'}>
          {value ? toPersianDigits(value.slice(0, 5)) : placeholder}
        </span>
        <Clock className="w-4 h-4 text-[#C5A059] shrink-0" />
      </button>

      {isOpen && (
        <div className="absolute z-50 mt-1.5 right-0 w-72 rounded-2xl bg-white border border-[#C5A059]/60 shadow-xl p-4 select-none space-y-3">
          <div className="flex items-center justify-between border-b border-slate-100 pb-2">
            <span className="text-xs font-bold text-[#0B192C]">تنظیم ساعت</span>
            <span className="text-sm font-extrabold text-[#9A7428] tabular-nums" dir="ltr">
              {toPersianDigits(`${pad2(hour)}:${pad2(minute)}`)}
            </span>
          </div>

          {/* انتخابگر ساعت و دقیقه */}
          <div className="grid grid-cols-2 gap-3 py-1" dir="ltr">
            <div className="rounded-xl bg-slate-50 border border-slate-200/80 p-2 flex flex-col items-center">
              <span className="text-[11px] text-slate-500 mb-1">ساعت</span>
              <button
                type="button"
                onClick={() => adjustHour(1)}
                className="w-9 h-8 rounded-lg hover:bg-slate-200/70 flex items-center justify-center text-[#0B192C] cursor-pointer"
              >
                <ChevronUp className="w-4 h-4" />
              </button>
              <span className="text-xl font-extrabold text-[#0B192C] tabular-nums my-1">
                {toPersianDigits(pad2(hour))}
              </span>
              <button
                type="button"
                onClick={() => adjustHour(-1)}
                className="w-9 h-8 rounded-lg hover:bg-slate-200/70 flex items-center justify-center text-[#0B192C] cursor-pointer"
              >
                <ChevronDown className="w-4 h-4" />
              </button>
            </div>

            <div className="rounded-xl bg-slate-50 border border-slate-200/80 p-2 flex flex-col items-center">
              <span className="text-[11px] text-slate-500 mb-1">دقیقه</span>
              <button
                type="button"
                onClick={() => adjustMinute(5)}
                className="w-9 h-8 rounded-lg hover:bg-slate-200/70 flex items-center justify-center text-[#0B192C] cursor-pointer"
              >
                <ChevronUp className="w-4 h-4" />
              </button>
              <span className="text-xl font-extrabold text-[#0B192C] tabular-nums my-1">
                {toPersianDigits(pad2(minute))}
              </span>
              <button
                type="button"
                onClick={() => adjustMinute(-5)}
                className="w-9 h-8 rounded-lg hover:bg-slate-200/70 flex items-center justify-center text-[#0B192C] cursor-pointer"
              >
                <ChevronDown className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* انتخاب سریع ساعات پرکاربرد */}
          <div>
            <span className="block text-[11px] text-slate-500 mb-1.5">انتخاب سریع:</span>
            <div className="grid grid-cols-4 gap-1.5" dir="ltr">
              {QUICK_TIMES.map((qt) => {
                const isSelected = `${pad2(hour)}:${pad2(minute)}` === qt;
                return (
                  <button
                    key={qt}
                    type="button"
                    onClick={() => applyTime(Number(qt.slice(0, 2)), Number(qt.slice(3, 5)))}
                    className={`h-8 rounded-lg text-xs font-semibold tabular-nums transition-colors cursor-pointer ${
                      isSelected
                        ? 'bg-[#0B192C] text-[#C5A059] border border-[#C5A059]'
                        : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                    }`}
                  >
                    {toPersianDigits(qt)}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="pt-2 border-t border-slate-100 flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => applyTime(hour, minute)}
              className="flex-1 min-h-[38px] rounded-xl bg-[#0B192C] text-[#C5A059] text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <Check className="w-3.5 h-3.5" />
              <span>تأیید ساعت</span>
            </button>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="min-h-[38px] px-3 rounded-xl text-xs font-medium text-slate-500 hover:bg-slate-100 cursor-pointer"
            >
              بستن
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
