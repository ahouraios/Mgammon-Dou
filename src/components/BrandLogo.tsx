import React, { useState } from 'react';

interface BrandLogoProps {
  size?: 'sm' | 'md' | 'lg';
}

export const BrandLogo: React.FC<BrandLogoProps> = ({ size = 'md' }) => {
  const [imgError, setImgError] = useState(false);

  const dimensions = {
    sm: 'w-9 h-9',
    md: 'w-14 h-14',
    lg: 'w-20 h-20',
  }[size];

  if (imgError) {
    return (
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
    );
  }

  return (
    <img
      src="/uploads/logo.png"
      alt="Mgammon"
      referrerPolicy="no-referrer"
      onError={() => setImgError(true)}
      className={`${dimensions} rounded-2xl object-contain bg-[#0B192C] border border-[#C5A059]/60 p-1 shadow-sm shrink-0`}
    />
  );
};
