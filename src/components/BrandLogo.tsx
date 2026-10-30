import React, { useEffect, useState } from 'react';
import { toPersianDigits } from '../shared/jalali';

export const APP_BADGE_EVENT = 'mgammon:badge-count';
let currentGlobalBadgeCount = 0;

export function updateAppNotificationBadge(count: number): void {
  const safeCount = Math.max(0, Math.floor(Number(count) || 0));
  currentGlobalBadgeCount = safeCount;

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent<number>(APP_BADGE_EVENT, { detail: safeCount }));
  }

  if (typeof document !== 'undefined') {
    const baseTitle = 'MGAMMON Duo — سامانه حضور، غیاب و امور مالی';
    document.title =
      safeCount > 0 ? `(${toPersianDigits(safeCount)}) ${baseTitle}` : baseTitle;
  }

  if (typeof navigator !== 'undefined') {
    const nav = navigator as Navigator & {
      setAppBadge?: (contents?: number) => Promise<void>;
      clearAppBadge?: () => Promise<void>;
    };
    try {
      if (safeCount > 0 && typeof nav.setAppBadge === 'function') {
        nav.setAppBadge(safeCount).catch(() => {});
      } else if (safeCount === 0 && typeof nav.clearAppBadge === 'function') {
        nav.clearAppBadge().catch(() => {});
      }
    } catch {
      // ignore unsupported badge API errors
    }
  }
}

interface BrandLogoProps {
  size?: 'sm' | 'md' | 'lg';
  badgeCount?: number;
}

export const BrandLogo: React.FC<BrandLogoProps> = ({ size = 'md', badgeCount }) => {
  const [imgError, setImgError] = useState(false);
  const [globalCount, setGlobalCount] = useState<number>(currentGlobalBadgeCount);

  useEffect(() => {
    const handler = (e: Event) => {
      const customEv = e as CustomEvent<number>;
      setGlobalCount(Math.max(0, Number(customEv.detail) || 0));
    };
    window.addEventListener(APP_BADGE_EVENT, handler);
    return () => {
      window.removeEventListener(APP_BADGE_EVENT, handler);
    };
  }, []);

  const effectiveCount = badgeCount !== undefined ? badgeCount : globalCount;

  const dimensions = {
    sm: 'w-9 h-9',
    md: 'w-14 h-14',
    lg: 'w-20 h-20',
  }[size];

  return (
    <div className="relative inline-flex shrink-0">
      {imgError ? (
        <div
          className={`${dimensions} rounded-2xl bg-[#0B192C] border border-[#C5A059] flex items-center justify-center shadow-sm shrink-0`}
          aria-label="Mgammon Logo"
        >
          <svg viewBox="0 0 64 64" className="w-3/5 h-3/5" fill="none">
            <circle cx="32" cy="32" r="28" stroke="#C5A059" strokeWidth="2" />
            <path
              d="M18 44V20H23L32 33L41 20H46V44H41.5V28.5L33.5 40H30.5L22.5 28.5V44H18Z"
              fill="#C5A059"
            />
          </svg>
        </div>
      ) : (
        <img
          src="/uploads/logo.png"
          alt="Mgammon"
          referrerPolicy="no-referrer"
          onError={() => setImgError(true)}
          className={`${dimensions} rounded-2xl object-contain bg-[#0B192C] border border-[#C5A059]/60 p-1 shadow-sm shrink-0`}
        />
      )}

      {effectiveCount > 0 && (
        <span
          title={`${toPersianDigits(effectiveCount)} اعلان جدید`}
          aria-label={`${toPersianDigits(effectiveCount)} اعلان جدید`}
          className="absolute -top-1.5 -right-1.5 min-w-[20px] h-5 px-1.5 rounded-full bg-red-600 text-white border-2 border-white text-[10px] font-extrabold flex items-center justify-center shadow-md tabular-nums animate-bounce z-10"
        >
          {effectiveCount > 99 ? toPersianDigits('99+') : toPersianDigits(effectiveCount)}
        </span>
      )}
    </div>
  );
};
