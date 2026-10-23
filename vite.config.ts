import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';
import {VitePWA} from 'vite-plugin-pwa';

export default defineConfig(() => {
  return {
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['icon.svg', 'apple-touch-icon.png', 'uploads/logo.png', 'fonts/Vazirmatn-VF.woff2'],
        manifest: {
          id: '/',
          name: 'MGAMMON Duo — سامانه حضور، غیاب و امور مالی',
          short_name: 'Mgammon',
          description: 'سامانه سبک و امن مدیریت حضور و غیاب، ساعات کاری، اضافه‌کاری، گزارش روزانه و پرداخت‌های پرسنل',
          theme_color: '#0B192C',
          background_color: '#F8FAFC',
          display: 'standalone',
          dir: 'rtl',
          lang: 'fa',
          start_url: '/',
          scope: '/',
          icons: [
            {
              src: '/pwa-192x192.png',
              sizes: '192x192',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: '/pwa-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: '/pwa-maskable-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
          ],
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
          navigateFallbackDenylist: [/^\/api\//],
        },
        devOptions: {
          enabled: false,
          type: 'module',
        },
      }),
      {
        name: 'disable-vite-client-ws-in-proxy',
        transform(code, id) {
          if (id.includes('vite/dist/client/client.mjs')) {
            return code.replace(
              /transport\.connect\(createHMRHandler\(handleMessage\)\);/g,
              '/* hmr ws disabled in proxy */'
            );
          }
          return null;
        },
      },
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      hmr: false,
      ws: false,
      watch: null,
    },
  };
});
