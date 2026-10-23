import React from 'react';

interface FooterProps {
  hasBottomNav?: boolean;
}

export const Footer: React.FC<FooterProps> = ({ hasBottomNav = false }) => {
  return (
    <footer
      className={`mt-6 border-t border-[#C5A059]/30 bg-white py-4 px-4 text-center ${
        hasBottomNav ? 'pb-24' : ''
      }`}
    >
      <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-slate-600">
        <span className="font-medium text-[#0B192C]">
          Mgammon — سامانه مدیریت کارکرد و حقوق پرسنل
        </span>
        <a
          href="https://ahourai.ir"
          target="_blank"
          rel="noopener noreferrer"
          className="text-slate-700 hover:text-[#0B192C] underline decoration-[#C5A059] underline-offset-4 transition-colors font-medium"
        >
          طراحی و توسعه توسط استودیو اهورایی با ❤️
        </a>
      </div>
    </footer>
  );
};
