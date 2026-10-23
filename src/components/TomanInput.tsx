import React from 'react';
import {
  formatNumericInputWithCommas,
  numberToPersianTomanWords,
  parseFormattedAmount,
  toPersianDigits,
} from '../shared/jalali';

interface TomanInputProps {
  value: string;
  onChange: (numericString: string) => void;
  label?: string;
  placeholder?: string;
  required?: boolean;
}

export const TomanInput: React.FC<TomanInputProps> = ({
  value,
  onChange,
  label = 'مبلغ (به تومان)',
  placeholder = 'مثلاً ۱۲,۵۰۰,۰۰۰',
  required = false,
}) => {
  const formattedEnglish = formatNumericInputWithCommas(value);
  const formattedPersianDisplay = toPersianDigits(formattedEnglish);
  const words = numberToPersianTomanWords(value);
  const numericVal = parseFormattedAmount(value);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    const cleanDigits = formatNumericInputWithCommas(raw).replace(/,/g, '');
    onChange(cleanDigits);
  };

  return (
    <div className="w-full space-y-1.5">
      {label && (
        <label className="block text-xs font-medium text-slate-700">
          {label}
        </label>
      )}
      <div className="relative flex items-center">
        <input
          type="text"
          inputMode="numeric"
          required={required}
          dir="ltr"
          value={formattedPersianDisplay}
          onChange={handleChange}
          placeholder={placeholder}
          className="w-full min-h-[44px] rounded-xl border border-slate-200 hover:border-[#C5A059] focus:border-[#0B192C] bg-white pl-14 pr-3.5 text-sm font-bold text-[#0B192C] text-right tabular-nums focus:outline-none transition-colors"
        />
        <span className="absolute left-3 text-[11px] font-semibold text-[#9A7428] select-none">
          تومان
        </span>
      </div>

      {/* نمایش زنده مبلغ به حروف فارسی در زیر کادر برای جلوگیری از اشتباه در تعداد صفرها */}
      {numericVal > 0 && words && (
        <div className="rounded-lg bg-[#0B192C]/[0.03] border border-[#C5A059]/35 px-3 py-1.5 text-[11px] text-[#0B192C] flex items-center justify-between gap-2">
          <span className="font-medium text-[#9A7428] shrink-0">به حروف:</span>
          <span className="font-bold text-right leading-5">{words}</span>
        </div>
      )}
    </div>
  );
};
