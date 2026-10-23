import React from 'react';

export const Footer: React.FC = () => {
  return (
    <footer className="mt-10 border-t border-[#C5A059]/30 bg-white py-5 px-4 text-center">
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
