import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// پاک‌سازی سرویس‌ورکرهای قدیمی کش‌شده در محیط توسعه برای جلوگیری از صفحه سفید
if (typeof window !== 'undefined' && 'serviceWorker' in navigator && import.meta.env.DEV) {
  navigator.serviceWorker
    .getRegistrations()
    .then((registrations) => {
      for (const registration of registrations) {
        registration.unregister();
      }
    })
    .catch(() => {
      // ignore
    });
}

class RootErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; errorText: string }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, errorText: '' };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, errorText: error?.message || 'خطای غیرمنتظره در بارگذاری صفحه' };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          dir="rtl"
          className="min-h-screen flex items-center justify-center bg-[#F9FAFB] p-6 text-center text-[#0B192C]"
        >
          <div className="max-w-sm w-full rounded-2xl bg-white border border-[#C5A059] p-6 space-y-3 shadow-sm">
            <h2 className="text-sm font-extrabold text-[#0B192C]">
              به‌روزرسانی صفحه مورد نیاز است
            </h2>
            <p className="text-xs text-slate-600 leading-5">
              نسخه جدیدی از سامانه بارگذاری شده است. لطفاً دکمه زیر را بزنید تا صفحه بازخوانی شود.
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="w-full min-h-[40px] rounded-xl bg-[#0B192C] text-[#C5A059] border border-[#C5A059] text-xs font-bold cursor-pointer"
            >
              بارگذاری مجدد سامانه
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById('root')!).render(
  <RootErrorBoundary>
    <App />
  </RootErrorBoundary>
);

