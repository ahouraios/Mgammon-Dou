-- ============================================================================
-- MGAMMON Duo — سامانه سبک حضور، غیاب، کارکرد و امور مالی
-- مدیریت: مجید نورایی | پرسنل: امید میثمی
-- ساختار جداول پایگاه داده MySQL 5.7/8.0+ و MariaDB 10.3+ (قابل ایمپورت در phpMyAdmin سی‌پنل)
-- ============================================================================

SET NAMES utf8mb4;
SET time_zone = '+03:30';

-- ۰. جدول نسخه‌بندی مهاجرت‌های ساختار پایگاه داده (Idempotent Schema Migrations)
CREATE TABLE IF NOT EXISTS `schema_migrations` (
  `version` INT UNSIGNED NOT NULL,
  `name` VARCHAR(120) NOT NULL,
  `checksum` VARCHAR(64) NOT NULL,
  `applied_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `execution_ms` INT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`version`),
  UNIQUE KEY `uq_schema_migrations_name` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ۱. جدول کاربران (فقط دو نقش: مدیر [مجید نورایی] و پرسنل [امید میثمی])
CREATE TABLE IF NOT EXISTS `users` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `username` VARCHAR(64) NOT NULL,
  `full_name` VARCHAR(120) NOT NULL,
  `role` ENUM('manager', 'worker') NOT NULL,
  `password_hash` VARCHAR(255) NOT NULL,
  `avatar_url` MEDIUMTEXT NULL DEFAULT NULL COMMENT 'تصویر پروفایل کاربر',
  `collaboration_start_shamsi` VARCHAR(10) NULL DEFAULT '1405/06/15' COMMENT 'تاریخ شروع همکاری',
  `phone_number` VARCHAR(20) NULL DEFAULT NULL COMMENT 'شماره همراه جهت دریافت پیامک',
  `biometric_credential_id` VARCHAR(255) NULL DEFAULT NULL COMMENT 'شناسه اثر انگشت / تشخیص چهره دستگاه',
  `biometric_token_hash` VARCHAR(255) NULL DEFAULT NULL COMMENT 'هش کلید ورود سریع بیومتریک',
  `must_change_password` TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'الزام تغییر رمز عبور اولیه',
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `last_login_at` DATETIME NULL DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_users_username` (`username`),
  UNIQUE KEY `uq_users_single_role` (`role`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ۲. جدول نشست‌های امنیتی کاربران (کنترل نشست در سمت سرور)
CREATE TABLE IF NOT EXISTS `user_sessions` (
  `token_hash` VARCHAR(128) NOT NULL,
  `user_id` INT UNSIGNED NOT NULL,
  `ip_address` VARCHAR(64) NULL DEFAULT NULL,
  `user_agent` VARCHAR(255) NULL DEFAULT NULL,
  `expires_at` DATETIME NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`token_hash`),
  KEY `idx_sessions_user_expires` (`user_id`, `expires_at`),
  CONSTRAINT `fk_sessions_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ۳. جدول ثبت تردد روزانه (شروع کار، شروع مأموریت، پایان مأموریت، پایان کار)
CREATE TABLE IF NOT EXISTS `attendance_logs` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` INT UNSIGNED NOT NULL,
  `work_date` DATE NOT NULL COMMENT 'تاریخ میلادی روز کاری بر اساس منطقه زمانی سامانه',
  `shamsi_date` VARCHAR(10) NOT NULL COMMENT 'تاریخ به فرمت YYYY/MM/DD',
  `event_type` ENUM('WORK_START', 'MISSION_START', 'MISSION_END', 'WORK_END') NOT NULL,
  `recorded_at` DATETIME NOT NULL COMMENT 'زمان دقیق ثبت عملیات',
  `recorded_time` VARCHAR(8) NOT NULL COMMENT 'ساعت ثبت در منطقه زمانی سامانه HH:MM:SS',
  `note` VARCHAR(500) NULL DEFAULT NULL,
  `is_manual_override` TINYINT(1) NOT NULL DEFAULT 0,
  `modified_by_user_id` INT UNSIGNED NULL DEFAULT NULL,
  `modification_reason` VARCHAR(500) NULL DEFAULT NULL,
  `is_deleted` TINYINT(1) NOT NULL DEFAULT 0,
  `idempotency_key` VARCHAR(64) NULL DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_attendance_idempotency` (`idempotency_key`),
  KEY `idx_attendance_user_date` (`user_id`, `work_date`, `is_deleted`),
  KEY `idx_attendance_shamsi` (`shamsi_date`),
  CONSTRAINT `fk_attendance_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`),
  CONSTRAINT `fk_attendance_modifier` FOREIGN KEY (`modified_by_user_id`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ۴. جدول سوابق قبلی کارکرد و اضافه‌کاری (دستی یا اکسل با تأیید مدیر)
CREATE TABLE IF NOT EXISTS `historical_work_records` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` INT UNSIGNED NOT NULL,
  `shamsi_date` VARCHAR(10) NOT NULL COMMENT 'تاریخ یا سررسید ثبت سابقه',
  `work_date` DATE NOT NULL,
  `title` VARCHAR(255) NOT NULL COMMENT 'عنوان دوره یا فایل اکسل سوابق',
  `work_days_count` INT UNSIGNED NOT NULL DEFAULT 1 COMMENT 'تعداد روز کاری معادل',
  `net_work_minutes` INT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'مدت ساعت کاری خالص به دقیقه',
  `overtime_minutes` INT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'مدت اضافه‌کاری به دقیقه',
  `note` VARCHAR(500) NULL DEFAULT NULL,
  `status` ENUM('PENDING', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'APPROVED',
  `excel_file_url` MEDIUMTEXT NULL DEFAULT NULL,
  `excel_file_name` VARCHAR(255) NULL DEFAULT NULL,
  `parsed_rows_json` LONGTEXT NULL DEFAULT NULL,
  `is_seen_by_manager` TINYINT(1) NOT NULL DEFAULT 0,
  `created_by_user_id` INT UNSIGNED NOT NULL,
  `reviewed_by_user_id` INT UNSIGNED NULL DEFAULT NULL,
  `reviewed_at` DATETIME NULL DEFAULT NULL,
  `idempotency_key` VARCHAR(64) NULL DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_hist_idempotency` (`idempotency_key`),
  KEY `idx_hist_work_shamsi` (`shamsi_date`),
  KEY `idx_hist_work_user_status` (`user_id`, `status`),
  CONSTRAINT `fk_hist_work_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`),
  CONSTRAINT `fk_hist_work_creator` FOREIGN KEY (`created_by_user_id`) REFERENCES `users` (`id`),
  CONSTRAINT `fk_hist_work_reviewer` FOREIGN KEY (`reviewed_by_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ۵. جدول گزارش‌های کار روزانه (همراه با تصویر کار انجام‌شده)
CREATE TABLE IF NOT EXISTS `daily_work_reports` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` INT UNSIGNED NOT NULL,
  `report_date` DATE NOT NULL,
  `shamsi_date` VARCHAR(10) NOT NULL,
  `activity_description` TEXT NOT NULL,
  `duration_minutes` INT UNSIGNED NULL DEFAULT NULL COMMENT 'مدت زمان صرف‌شده به دقیقه (اختیاری)',
  `photo_url` MEDIUMTEXT NULL DEFAULT NULL COMMENT 'تصویر کار انجام‌شده',
  `photo_name` VARCHAR(255) NULL DEFAULT NULL COMMENT 'نام فایل تصویر گزارش',
  `recorded_time` VARCHAR(8) NOT NULL,
  `is_seen_by_manager` TINYINT(1) NOT NULL DEFAULT 0,
  `idempotency_key` VARCHAR(64) NULL DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_reports_idempotency` (`idempotency_key`),
  KEY `idx_reports_user_date` (`user_id`, `report_date`),
  KEY `idx_reports_shamsi` (`shamsi_date`),
  CONSTRAINT `fk_reports_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ۶. جدول تراکنش‌ها، درخواست‌های مالی و هزینه‌های تنخواه / خرید کارگاهی
CREATE TABLE IF NOT EXISTS `financial_transactions` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` INT UNSIGNED NOT NULL COMMENT 'کاربر دریافت‌کننده (امید میثمی)',
  `created_by_user_id` INT UNSIGNED NOT NULL COMMENT 'ثبت‌کننده (پرسنل یا مدیر)',
  `amount_toman` DECIMAL(15, 0) NOT NULL,
  `tx_type` ENUM('ADVANCE', 'ON_ACCOUNT', 'SALARY', 'PETTY_CASH', 'OTHER') NOT NULL,
  `tx_date` DATE NOT NULL,
  `shamsi_date` VARCHAR(10) NOT NULL,
  `description` VARCHAR(1000) NOT NULL,
  `receipt_file_url` MEDIUMTEXT NULL DEFAULT NULL COMMENT 'تصویر فاکتور خرید کارگاهی یا رسید واریز',
  `receipt_file_name` VARCHAR(255) NULL DEFAULT NULL COMMENT 'نام فایل فاکتور یا رسید',
  `status` ENUM('PENDING', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'PENDING',
  `is_seen_by_manager` TINYINT(1) NOT NULL DEFAULT 0,
  `reviewed_by_user_id` INT UNSIGNED NULL DEFAULT NULL,
  `reviewed_at` DATETIME NULL DEFAULT NULL,
  `manager_note` VARCHAR(500) NULL DEFAULT NULL,
  `idempotency_key` VARCHAR(64) NULL DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_fin_idempotency` (`idempotency_key`),
  KEY `idx_fin_user_status` (`user_id`, `status`),
  KEY `idx_fin_status_date` (`status`, `tx_date`),
  KEY `idx_fin_shamsi` (`shamsi_date`),
  KEY `idx_fin_type` (`tx_type`),
  CONSTRAINT `fk_fin_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`),
  CONSTRAINT `fk_fin_creator` FOREIGN KEY (`created_by_user_id`) REFERENCES `users` (`id`),
  CONSTRAINT `fk_fin_reviewer` FOREIGN KEY (`reviewed_by_user_id`) REFERENCES `users` (`id`),
  CONSTRAINT `chk_fin_amount_positive` CHECK (`amount_toman` > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ۷. جدول تنظیمات قواعد کارکرد، پنجشنبه‌ها، حقوق، اضافه‌کاری و پیامک
CREATE TABLE IF NOT EXISTS `system_settings` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `shift_start_time` VARCHAR(5) NOT NULL DEFAULT '07:00' COMMENT 'ساعت شروع شیفت HH:MM',
  `shift_end_time` VARCHAR(5) NOT NULL DEFAULT '15:00' COMMENT 'ساعت پایان شیفت HH:MM',
  `thursday_shift_start_time` VARCHAR(5) NOT NULL DEFAULT '07:00' COMMENT 'ساعت شروع شیفت پنجشنبه HH:MM',
  `thursday_shift_end_time` VARCHAR(5) NOT NULL DEFAULT '14:00' COMMENT 'ساعت پایان شیفت پنجشنبه HH:MM',
  `thursday_overtime_start_time` VARCHAR(5) NOT NULL DEFAULT '14:00' COMMENT 'ساعت شروع اضافه‌کاری پنجشنبه HH:MM',
  `grace_period_minutes` INT UNSIGNED NOT NULL DEFAULT 15 COMMENT 'فرجه مجاز تأخیر به دقیقه',
  `break_duration_minutes` INT UNSIGNED NOT NULL DEFAULT 30 COMMENT 'زمان استراحت روزانه به دقیقه',
  `working_days_json` VARCHAR(64) NOT NULL DEFAULT '[6,0,1,2,3,4]' COMMENT 'روزهای کاری هفته (۶=شنبه تا ۴=پنجشنبه، ۵=جمعه)',
  `overtime_start_time` VARCHAR(5) NOT NULL DEFAULT '15:00' COMMENT 'ساعت شروع محاسبه اضافه‌کاری عصر',
  `overtime_before_shift` TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'محاسبه حضور پیش از شروع شیفت به عنوان اضافه‌کاری',
  `mission_policy` ENUM('PAID_AS_WORK', 'SEPARATE_EXTRA') NOT NULL DEFAULT 'PAID_AS_WORK' COMMENT 'نحوه محاسبه مأموریت',
  `friday_holiday_policy` ENUM('ALL_OVERTIME', 'REGULAR_WORK', 'DISABLED') NOT NULL DEFAULT 'ALL_OVERTIME' COMMENT 'نحوه محاسبه کار در جمعه و تعطیلات رسمی',
  `official_holidays_json` TEXT NOT NULL COMMENT 'آرایه تاریخ‌های تعطیل رسمی به فرمت YYYY/MM/DD',
  `timezone` VARCHAR(64) NOT NULL DEFAULT 'Asia/Tehran',
  `base_salary_toman` DECIMAL(15, 0) NULL DEFAULT NULL COMMENT 'مبلغ حقوق پایه ماهانه به تومان',
  `hourly_rate_toman` DECIMAL(15, 0) NULL DEFAULT NULL COMMENT 'نرخ پایه ساعتی به تومان',
  `overtime_calc_mode` ENUM('FIXED_RATE', 'PERCENTAGE') NOT NULL DEFAULT 'PERCENTAGE' COMMENT 'نحوه محاسبه نرخ اضافه‌کاری',
  `overtime_percentage` DECIMAL(6, 2) NOT NULL DEFAULT 140.00 COMMENT 'درصد ضریب اضافه‌کاری نسبت به ساعت کاری عادی',
  `overtime_rate_toman` DECIMAL(15, 0) NULL DEFAULT NULL COMMENT 'مبلغ ثابت هر ساعت اضافه‌کاری به تومان',
  `collaboration_start_shamsi` VARCHAR(10) NOT NULL DEFAULT '1405/06/15' COMMENT 'تاریخ شروع قرارداد پرسنل',
  `monthly_leave_quota_days` DECIMAL(4, 1) NOT NULL DEFAULT 2.5 COMMENT 'سقف مرخصی استحقاقی ماهانه به روز',
  `sms_enabled` TINYINT(1) NOT NULL DEFAULT 0,
  `melipayamak_username` VARCHAR(120) NOT NULL DEFAULT '',
  `melipayamak_password` VARCHAR(255) NOT NULL DEFAULT '',
  `melipayamak_from_number` VARCHAR(64) NOT NULL DEFAULT '',
  `melipayamak_is_flash` TINYINT(1) NOT NULL DEFAULT 0,
  `worker_phone_number` VARCHAR(20) NOT NULL DEFAULT '',
  `rules_confirmed_by_manager` TINYINT(1) NOT NULL DEFAULT 0,
  `effective_from_shamsi` VARCHAR(10) NOT NULL DEFAULT '1405/06/15',
  `banner_bg_url` MEDIUMTEXT NULL DEFAULT NULL,
  `updated_by_user_id` INT UNSIGNED NULL DEFAULT NULL,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ۸. جدول تاریخچه تنظیمات (برای حفظ محاسبات ماه‌های گذشته در صورت تغییر قواعد)
CREATE TABLE IF NOT EXISTS `system_settings_snapshots` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `effective_from_shamsi` VARCHAR(10) NOT NULL,
  `settings_json` JSON NOT NULL,
  `created_by_user_id` INT UNSIGNED NULL DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_snapshot_effective` (`effective_from_shamsi`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ۹. جدول مکاتبات کاری، پیام‌رسانی، پیام صوتی و ارسال فایل بین مدیریت و پرسنل
CREATE TABLE IF NOT EXISTS `work_correspondences` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `sender_user_id` INT UNSIGNED NOT NULL,
  `receiver_user_id` INT UNSIGNED NOT NULL,
  `parent_id` INT UNSIGNED NULL DEFAULT NULL,
  `subject` VARCHAR(255) NULL DEFAULT NULL,
  `message_text` TEXT NOT NULL,
  `audio_url` MEDIUMTEXT NULL DEFAULT NULL COMMENT 'فایل صوتی ضبط‌شده در برنامه',
  `audio_duration_seconds` INT UNSIGNED NULL DEFAULT NULL COMMENT 'مدت زمان پیام صوتی به ثانیه',
  `attachments_json` LONGTEXT NULL DEFAULT NULL COMMENT 'فایل‌های پیوست به صورت JSON',
  `delivery_channel` ENUM('IN_APP', 'SMS', 'BOTH') NOT NULL DEFAULT 'IN_APP',
  `sms_sent` TINYINT(1) NOT NULL DEFAULT 0,
  `sms_status_text` VARCHAR(255) NULL DEFAULT NULL,
  `shamsi_date` VARCHAR(10) NOT NULL,
  `work_date` DATE NOT NULL,
  `recorded_time` VARCHAR(8) NOT NULL,
  `is_read` TINYINT(1) NOT NULL DEFAULT 0,
  `read_at` DATETIME NULL DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_corr_shamsi` (`shamsi_date`),
  KEY `idx_corr_receiver_read` (`receiver_user_id`, `is_read`),
  CONSTRAINT `fk_corr_sender` FOREIGN KEY (`sender_user_id`) REFERENCES `users` (`id`),
  CONSTRAINT `fk_corr_receiver` FOREIGN KEY (`receiver_user_id`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ۱۰. جدول درخواست‌های مرخصی ساعتی و روزانه پرسنل
CREATE TABLE IF NOT EXISTS `leave_requests` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` INT UNSIGNED NOT NULL,
  `shamsi_date` VARCHAR(10) NOT NULL,
  `work_date` DATE NOT NULL,
  `leave_type` ENUM('DAILY', 'HOURLY') NOT NULL DEFAULT 'DAILY',
  `start_time` VARCHAR(5) NULL DEFAULT NULL,
  `end_time` VARCHAR(5) NULL DEFAULT NULL,
  `duration_minutes` INT UNSIGNED NOT NULL DEFAULT 480,
  `reason` VARCHAR(500) NOT NULL,
  `status` ENUM('PENDING', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'PENDING',
  `is_seen_by_manager` TINYINT(1) NOT NULL DEFAULT 0,
  `manager_note` VARCHAR(500) NULL DEFAULT NULL,
  `reviewed_by_user_id` INT UNSIGNED NULL DEFAULT NULL,
  `reviewed_at` DATETIME NULL DEFAULT NULL,
  `idempotency_key` VARCHAR(64) NULL DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_leaves_idempotency` (`idempotency_key`),
  KEY `idx_leave_shamsi` (`shamsi_date`),
  KEY `idx_leave_status` (`status`),
  CONSTRAINT `fk_leave_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`),
  CONSTRAINT `fk_leave_reviewer` FOREIGN KEY (`reviewed_by_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ۱۱. جدول چک‌لیست کارها و وظایف روزانه محول‌شده به پرسنل
CREATE TABLE IF NOT EXISTS `work_tasks` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` INT UNSIGNED NOT NULL,
  `created_by_user_id` INT UNSIGNED NOT NULL,
  `shamsi_date` VARCHAR(10) NOT NULL,
  `title` VARCHAR(255) NOT NULL,
  `description` VARCHAR(500) NULL DEFAULT NULL,
  `is_completed` TINYINT(1) NOT NULL DEFAULT 0,
  `completed_at` DATETIME NULL DEFAULT NULL,
  `added_to_report` TINYINT(1) NOT NULL DEFAULT 0,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_tasks_shamsi` (`shamsi_date`),
  CONSTRAINT `fk_tasks_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ۱۲. جدول لاگ ممیزی (Audit Logs) برای ثبت تمام عملیات حساس در سمت سرور
CREATE TABLE IF NOT EXISTS `audit_logs` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `actor_user_id` INT UNSIGNED NULL DEFAULT NULL,
  `action_type` VARCHAR(64) NOT NULL,
  `target_entity` VARCHAR(64) NOT NULL,
  `target_id` INT UNSIGNED NULL DEFAULT NULL,
  `before_state` JSON NULL DEFAULT NULL,
  `after_state` JSON NULL DEFAULT NULL,
  `reason` VARCHAR(500) NULL DEFAULT NULL,
  `ip_address` VARCHAR(64) NULL DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_audit_created` (`created_at`),
  KEY `idx_audit_entity` (`target_entity`, `target_id`),
  CONSTRAINT `fk_audit_actor` FOREIGN KEY (`actor_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
