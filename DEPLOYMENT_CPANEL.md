# راهنمای جامع استقرار، راه‌اندازی PWA و پشتیبان‌گیری در cPanel
## سامانه MGAMMON Duo (حضور، غیاب، کارکرد و امور مالی)

این مستند تمام مراحل استقرار واقعی وب‌اپلیکیشن **MGAMMON Duo** را بر پایه محدودیت‌ها و استانداردهای `Setup Node.js App` ( مبتنی بر Phusion Passenger) و پایگاه داده `MySQL / MariaDB` در هاست اشتراکی **cPanel** شرح می‌دهد.

---

### ۱. ساخت دیتابیس و کاربر MySQL در cPanel
1. وارد پنل هاست **cPanel** خود شوید و از بخش **Databases** گزینه **MySQL® Database Wizard** را باز کنید.
2. یک نام برای دیتابیس وارد کنید (مثلاً `cpaneluser_mgammon_duo`) و روی **Next Step** کلیک کنید.
3. یک نام کاربری دیتابیس (مثلاً `cpaneluser_mgammon`) و یک رمز عبور قوی ایجاد کنید.
4. در مرحله دسترسی‌ها، تیک گزینه **ALL PRIVILEGES** را فعال کرده و روی **Make Changes** کلیک کنید.

---

### ۲. راه‌اندازی ساختار جداول و مهاجرت خودکار (`database/schema.sql`)
1. برنامه در اولین اجرا روی دیتابیس کاملاً خالی، به‌صورت خودکار تمام **۱۳ جدول اصلی** (`schema_migrations`, `users`, `user_sessions`, `attendance_logs`, `historical_work_records`, `daily_work_reports`, `financial_transactions`, `system_settings`, `system_settings_snapshots`, `work_correspondences`, `leave_requests`, `work_tasks`, `audit_logs`) را با Encoding استاندارد `utf8mb4_unicode_ci` ایجاد کرده و مهاجرت‌های نسخه‌بندی‌شده (`v1` تا `v6`) را اجرا می‌کند.
2. در صورت تمایل به ایمپورت دستی پیش از اجرا، می‌توانید در **phpMyAdmin** دیتابیس ساخته‌شده را انتخاب کرده و از زبانه **Import** فایل `database/schema.sql` را وارد نمایید.
3. در اولین راه‌اندازی، تنها **دو حساب کاربری اولیه** شامل مدیر (**مجید نورایی** با نقش `manager`) و پرسنل (**امید میثمی** با نقش `worker`) با رمزهای هش‌شده (`bcrypt`) و وضعیت الزام تغییر رمز اولیه (`must_change_password = 1`) به همراه تنظیمات پایه سامانه ایجاد می‌شوند و هیچ داده آزمایشی وارد دیتابیس نمی‌گردد.
4. تنظیمات وب‌سرویس پیامک (**ملی‌پیامک**) در ابتدای راه‌اندازی الزامی نیست و نبودن آن مانع اجرای هیچ‌یک از بخش‌های سامانه نمی‌شود؛ مدیر می‌تواند پس از ورود، از بخش **«تنظیمات سامانه»** مشخصات خط و حساب ملی‌پیامک را ثبت و آزمایش کند.

---

### ۳. آماده‌سازی و بیلد پروژه برای cPanel
پیش از آپلود روی هاست (یا پس از آپلود از طریق Terminal سی‌پنل)، دستور زیر را اجرا کنید:
```bash
npm install
npm run build
```
این دستور دو خروجی استاندارد تولید می‌کند:
- پوشه `dist/`: شامل فایل‌های کامپایل‌شده فرانت‌اند React، سرویس‌ورکر PWA، مانیفست و فونت محلی `Vazirmatn-VF.woff2`.
- فایل `app.cjs`: فایل اجرایی یکپارچه سرور Node.js + Express با فرمت CommonJS که کاملاً با لودر **Phusion Passenger** در cPanel سازگار است.

---

### ۴. تنظیم Node.js Application در cPanel
1. در cPanel از بخش **Software** وارد **Setup Node.js App** شوید و روی **Create Application** کلیک کنید.
2. مقادیر زیر را تنظیم نمایید:
   - **Node.js version**: نسخه `20.x LTS` یا `22.x` را انتخاب کنید.
   - **Application mode**: روی `Production` قرار دهید.
   - **Application root**: مسیر پوشه برنامه روی هاست (مثلاً `mgammon-duo`).
   - **Application URL**: دامنه یا ساب‌دامنه مورد نظر خود را انتخاب کنید.
   - **Application startup file**: مقدار `app.cjs` را وارد کنید.
3. در بخش **Environment variables** متغیرهای زیر را تعریف کنید (یا در فایل `.env` در ریشه برنامه قرار دهید):
   ```env
   NODE_ENV=production
   SESSION_SECRET=یک_رشته_تصادفی_۶۴_کاراکتری_امن_وارد_کنید
   DB_HOST=127.0.0.1
   DB_PORT=3306
   DB_USER=cpaneluser_mgammon
   DB_PASSWORD=رمز_عبور_دیتابیس_شما
   DB_NAME=cpaneluser_mgammon_duo
   INITIAL_MANAGER_USERNAME=manager
   INITIAL_MANAGER_PASSWORD=رمز_اولیه_مدیر
   INITIAL_WORKER_USERNAME=worker
   INITIAL_WORKER_PASSWORD=رمز_اولیه_نیرو
   APP_TIMEZONE=Asia/Tehran
   ```
4. روی دکمه **Create** کلیک کنید.
5. در صورتی که پوشه `node_modules` را آپلود نکرده‌اید، روی دکمه **Run NPM Install** در همان صفحه کلیک کنید و سپس دکمه **Restart** را بزنید.

---

### ۵. قرار دادن لوگوی اختصاصی (`/uploads/logo.png`)
- فایل لوگوی مجموعه در مسیر `public/uploads/logo.png` (و پس از بیلد در `dist/uploads/logo.png`) قرار می‌گیرد.
- اگر در هر زمان فایل لوگو جایگزین یا حذف شود، برنامه بدون هیچ خطایی نشانگر وکتور سرمه‌ای و طلایی `Mgammon` را نمایش می‌دهد.

---

### ۶. فعال‌سازی HTTPS و امنیت کوکی‌ها
1. در cPanel وارد بخش **SSL/TLS Status** شده و روی **Run AutoSSL** کلیک کنید تا گواهی SSL رایگان روی دامنه فعال شود.
2. در بخش **Domains** گزینه **Force HTTPS Redirect** را روشن کنید.
3. فعال بودن HTTPS برای کارکرد صحیح **Service Worker (قابلیت PWA)** و کوکی‌های امن `HttpOnly + Secure` الزامی است.

---

### ۷. راه‌اندازی و آزمایش PWA روی موبایل
1. آدرس HTTPS سایت را در مرورگر موبایل (Chrome در اندروید یا Safari در iOS) باز کنید.
2. در نوار بالای برنامه دکمه **«نصب وب‌اپلیکیشن»** نمایش داده می‌شود.
3. با لمس آن، برنامه با آیکون اختصاصی `Mgammon` و در حالت تمام‌صفحه (`standalone`) به صفحه اصلی گوشی اضافه می‌شود.

---

### ۸. روش تهیه نسخه پشتیبان (Backup) و بازیابی دیتابیس (Restore)

#### الف) تهیه نسخه پشتیبان (Backup)
- **روش ۱ (از طریق cPanel Backup Wizard):**
  وارد **Backup** در cPanel شوید و در بخش **Download a MySQL Database Backup** روی نام دیتابیس `cpaneluser_mgammon_duo` کلیک کنید تا فایل فشرده `.sql.gz` دانلود شود.
- **روش ۲ (از طریق خط فرمان یا Cron Job در cPanel):**
  ```bash
  mysqldump -u cpaneluser_mgammon -p'YOUR_DB_PASSWORD' --single-transaction --routines --triggers cpaneluser_mgammon_duo > backup_mgammon_$(date +%F).sql
  ```

#### ب) بازیابی نسخه پشتیبان (Restore)
- **از طریق phpMyAdmin:** دیتابیس را انتخاب کرده، وارد تب **Import** شوید و فایل `.sql` یا `.sql.gz` پشتیبان را انتخاب و بازگردانی کنید.
- **از طریق خط فرمان:**
  ```bash
  mysql -u cpaneluser_mgammon -p'YOUR_DB_PASSWORD' cpaneluser_mgammon_duo < backup_mgammon_YYYY-MM-DD.sql
  ```
