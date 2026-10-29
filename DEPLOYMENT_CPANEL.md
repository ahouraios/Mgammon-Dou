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

### ۳. محتویات بسته استقرار و اسکریپت ساخت خودکار (`npm run deploy:package`)
برای ساخت خودکار، اعتبارسنجی و فشرده‌سازی پکیج استقرار، دستور زیر در پروژه تعریف شده است:
```bash
npm run deploy:package
```
این دستور به‌صورت خودکار و متوالی:
1. اعتبارسنجی تایپ‌اسکریپت (`npm run lint`) را اجرا می‌کند.
2. آزمون‌های خودکار پروژه (`npm test`) را بررسی می‌کند.
3. بیلد کامل Production کلاینت و سرور (`npm run build`) را تولید می‌کند.
4. فایل‌های ضروری Production را گردآوری و فایل فشرده **`mgammon-duo-cpanel-deploy.zip`** را در ریشه پروژه ایجاد می‌کند.

**محتویات این بسته شامل:**
- **`app.cjs`**: فایل اجرایی یکپارچه سرور Node.js + Express با فرمت CommonJS (سازگار با Node.js 22 و لودر **Phusion Passenger** در cPanel).
- **`dist/`**: پوشه کامپایل‌شده فرانت‌اند React، سرویس‌ورکر PWA (`sw.js`, `registerSW.js`)، مانیفست (`manifest.webmanifest`) و فونت محلی `Vazirmatn-VF.woff2`.
- **`public/`**: فایل‌های استاتیک پایه، آیکون‌های PWA و بنر پیش‌فرض.
- **`package.json` و `package-lock.json`**: مشخصات دقیق وابستگی‌های Production سازگار با Node.js 22 و دستور استارت هماهنگ با سرور بیلدشده (`npm start` -> `node app.cjs`).
- **`database/schema.sql`**: اسکریپت کامل ساختار ۱۳ جدول پایگاه داده (مورد استفاده در راه‌اندازی دیتابیس).
- **`.env.example`**: الگوی متغیرهای محیطی (فاقد هرگونه کلید یا رمز محرمانه).
- **`DEPLOYMENT_CPANEL.md`**: راهنمای جامع استقرار.

> **نکته مهم:** از آنجا که `app.cjs` و پوشه `dist/` از قبل در بسته استقرار ساخته و قرار داده شده‌اند، روی هاست cPanel **نیازی به اجرای `npm run build` نیست**. اسکریپت `deploy:package` صرفاً ابزار محیط توسعه است و در محیط Production نیازی به آن نیست. همچنین پوشه‌های `node_modules/`، `.data/` و فایل‌های محرمانه `.env` در بسته قرار ندارند و وابستگی‌ها مستقیماً روی هاست نصب می‌شوند.

---

### ۴. تنظیم Node.js Application و نصب وابستگی‌ها در cPanel
1. فایل فشرده پروژه (یا فایل `mgammon-duo-cpanel-deploy.zip`) را در پوشه برنامه روی هاست (مثلاً `/home/cpaneluser/mgammon-duo`) آپلود و **Extract** کنید.
2. در cPanel از بخش **Software** وارد **Setup Node.js App** شوید و روی **Create Application** کلیک کنید.
3. مقادیر زیر را تنظیم نمایید:
   - **Node.js version**: نسخه `22.x` (پیشنهادی) یا `20.x LTS` را انتخاب کنید.
   - **Application mode**: روی `Production` قرار دهید.
   - **Application root**: مسیر پوشه برنامه روی هاست (مثلاً `mgammon-duo`).
   - **Application URL**: دامنه یا ساب‌دامنه مورد نظر خود را انتخاب کنید.
   - **Application startup file**: دقیقاً مقدار زیر را وارد کنید:
     ```text
     app.cjs
     ```
4. در بخش **Environment variables** متغیرهای زیر را تعریف کنید (یا در فایل `.env` در ریشه برنامه قرار دهید):
   ```env
   NODE_ENV=production
   SESSION_SECRET=یک_رشته_تصادفی_حداقل_۳۲_تا_۶۴_کاراکتری_امن_وارد_کنید
   DB_HOST=127.0.0.1
   DB_PORT=3306
   DB_USER=cpaneluser_mgammon
   DB_PASSWORD=رمز_عبور_دیتابیس_شما
   DB_NAME=cpaneluser_mgammon_duo
   INITIAL_MANAGER_USERNAME=manager
   INITIAL_MANAGER_PASSWORD=رمز_اولیه_امن_مدیر
   INITIAL_WORKER_USERNAME=worker
   INITIAL_WORKER_PASSWORD=رمز_اولیه_امن_کارمند
   APP_TIMEZONE=Asia/Tehran
   ```
5. روی دکمه **Create** کلیک کنید.
6. **نصب وابستگی‌ها روی هاست:** پس از ساخته شدن اپلیکیشن، در همان صفحه **Setup Node.js App** روی دکمه **Run NPM Install** کلیک کنید (این دکمه با استفاده از `package.json` و `package-lock.json` موجود در بسته، پکیج‌های موردنیاز سرور را در محیط مجازی Node.js هاست نصب می‌کند؛ همچنین در صورت دسترسی به Terminal می‌توانید دستور `npm ci --omit=dev` را اجرا نمایید).
7. پس از اتمام نصب وابستگی‌ها، روی دکمه **Restart** کلیک کنید.

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
