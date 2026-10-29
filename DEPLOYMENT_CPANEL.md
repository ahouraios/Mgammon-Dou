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

### ۳. تفکیک مرحله ساخت بسته (در محیط توسعه) از محتویات بسته آماده نصب روی هاست

#### الف) مرحله ساخت بسته در پروژه اصلی توسعه (مخصوص محیط توسعه — خارج از هاست cPanel)
- دستور `npm run deploy:package` (به همراه اسکریپت‌های پوشه `scripts/`) **صرفاً یک ابزار توسعه در پروژه اصلی (Development Repository)** است که پیش از انتشار، وظیفه اجرای بررسی‌های تایپ‌اسکریپت (`lint`)، آزمون‌های خودکار (`test`)، کامپایل فرانت‌اند و سرور (`dist/` و `app.cjs`) و تولید فایل فشرده `mgammon-duo-cpanel-deploy.zip` را بر عهده دارد.
- **این دستور و پوشه `scripts/` داخل بسته نهایی Production (`mgammon-duo-cpanel-deploy.zip`) وجود ندارند.** بنابراین هنگام نصب و راه‌اندازی برنامه روی هاست cPanel، به هیچ عنوان نیازی به اجرای `npm run deploy:package` یا `npm run build` نیست و تمام مراحل نصب روی هاست صرفاً از طریق بخش ۴ (بر پایه `app.cjs`، نصب وابستگی‌ها و `npm start`) انجام می‌شود.

#### ب) محتویات بسته نهایی Production (`mgammon-duo-cpanel-deploy.zip`) جهت آپلود روی هاست
فایل فشرده `mgammon-duo-cpanel-deploy.zip` از پیش بیلد شده و فقط شامل فایل‌های اجرایی و ضروری محیط عملیاتی (Production) زیر است:
- **`app.cjs`**: فایل اجرایی یکپارچه سرور Node.js + Express با فرمت CommonJS (سازگار با Node.js 22 و لودر **Phusion Passenger** در cPanel).
- **`dist/`**: پوشه کامپایل‌شده فرانت‌اند React، سرویس‌ورکر PWA (`sw.js`, `registerSW.js`)، مانیفست (`manifest.webmanifest`) و فونت محلی `Vazirmatn-VF.woff2`.
- **`public/`**: فایل‌های استاتیک پایه، آیکون‌های PWA و بنر پیش‌فرض.
- **`package.json` و `package-lock.json`**: مشخصات وابستگی‌های سازگار با Node.js 22 که در نسخه داخل ZIP فقط شامل دستورات اجرایی Production (`"start": "node app.cjs"` و `"start:prod": "NODE_ENV=production node app.cjs"`) است و فاقد اسکریپت‌های توسعه می‌باشد.
- **`database/schema.sql`**: اسکریپت کامل ساختار ۱۳ جدول پایگاه داده (مورد استفاده در راه‌اندازی دیتابیس).
- **`.env.example`**: الگوی متغیرهای محیطی (فاقد هرگونه کلید یا رمز محرمانه).
- **`DEPLOYMENT_CPANEL.md`**: راهنمای جامع استقرار روی هاست.
- *(پوشه‌های `node_modules/`، `.data/`، `scripts/`، `tests/` و فایل محرمانه `.env` در این بسته قرار ندارند و وابستگی‌ها طبق بخش ۴ مستقیماً روی هاست نصب می‌شوند.)*

---

### ۴. مراحل نصب وابستگی‌ها و اجرای برنامه در cPanel (متکی بر `app.cjs` و `npm start`)
1. فایل فشرده **`mgammon-duo-cpanel-deploy.zip`** را در پوشه برنامه روی هاست (مثلاً `/home/cpaneluser/mgammon-duo`) آپلود و **Extract** کنید.
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
6. **نصب وابستگی‌ها روی هاست:** پس از ساخته شدن اپلیکیشن، در همان صفحه **Setup Node.js App** روی دکمه **Run NPM Install** کلیک کنید تا پکیج‌های موردنیاز از روی `package.json` و `package-lock.json` روی هاست نصب شوند (در صورت استفاده از Terminal سی‌پنل نیز می‌توانید در محیط مجازی برنامه دستور `npm ci --omit=dev` یا `npm install --omit=dev` را اجرا کنید).
7. **اجرای برنامه:** روی دکمه **Restart** در Setup Node.js App کلیک کنید تا Passenger فایل اجرایی **`app.cjs`** را اجرا کند (همچنین در صورت اجرای دستی یا از طریق خط فرمان، دستور **`npm start`** مستقیماً `node app.cjs` را اجرا می‌نماید).

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
