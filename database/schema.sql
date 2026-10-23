-- ============================================================================
-- MGAMMON Duo — سامانه سبک حضور، غیاب، کارکرد و امور مالی
-- ساختار جداول پایگاه داده MySQL / MariaDB (قابل ایمپورت در phpMyAdmin سی‌پنل)
-- ============================================================================

SET NAMES utf8mb4;
SET time_zone = '+03:30';

-- ۱. جدول کاربران (فقط دو نقش: مدیر و نیروی کاری)
CREATE TABLE IF NOT EXISTS `users` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `username` VARCHAR(64) NOT NULL,
  `full_name` VARCHAR(120) NOT NULL,
  `role` ENUM('manager', 'worker') NOT NULL,
  `password_hash` VARCHAR(255) NOT NULL,
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

-- ۳. جدول ثبت تردد (شروع کار، شروع مأموریت، پایان مأموریت، پایان کار)
CREATE TABLE IF NOT EXISTS `attendance_logs` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` INT UNSIGNED NOT NULL,
  `work_date` DATE NOT NULL COMMENT 'تاریخ میلادی روز کاری بر اساس منطقه زمانی سامانه',
  `shamsi_date` VARCHAR(10) NOT NULL COMMENT 'تاریخ شمسی به فرمت YYYY/MM/DD',
  `event_type` ENUM('WORK_START', 'MISSION_START', 'MISSION_END', 'WORK_END') NOT NULL,
  `recorded_at` DATETIME NOT NULL COMMENT 'زمان دقیق ثبت عملیات',
  `recorded_time` VARCHAR(8) NOT NULL COMMENT 'ساعت ثبت در منطقه زمانی سامانه HH:MM:SS',
  `note` VARCHAR(500) NULL DEFAULT NULL,
  `is_manual_override` TINYINT(1) NOT NULL DEFAULT 0,
  `modified_by_user_id` INT UNSIGNED NULL DEFAULT NULL,
  `modification_reason` VARCHAR(500) NULL DEFAULT NULL,
  `is_deleted` TINYINT(1) NOT NULL DEFAULT 0,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_attendance_user_date` (`user_id`, `work_date`, `is_deleted`),
  KEY `idx_attendance_shamsi` (`shamsi_date`),
  CONSTRAINT `fk_attendance_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`),
  CONSTRAINT `fk_attendance_modifier` FOREIGN KEY (`modified_by_user_id`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ۴. جدول گزارش‌های کار روزانه
CREATE TABLE IF NOT EXISTS `daily_work_reports` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` INT UNSIGNED NOT NULL,
  `report_date` DATE NOT NULL,
  `shamsi_date` VARCHAR(10) NOT NULL,
  `activity_description` TEXT NOT NULL,
  `duration_minutes` INT UNSIGNED NULL DEFAULT NULL COMMENT 'مدت زمان صرف‌شده به دقیقه (اختیاری)',
  `recorded_time` VARCHAR(8) NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_reports_user_date` (`user_id`, `report_date`),
  KEY `idx_reports_shamsi` (`shamsi_date`),
  CONSTRAINT `fk_reports_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ۵. جدول تراکنش‌ها و درخواست‌های مالی (استفاده از DECIMAL دقیق برای مبالغ تومان)
CREATE TABLE IF NOT EXISTS `financial_transactions` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` INT UNSIGNED NOT NULL COMMENT 'کاربر دریافت‌کننده (نیروی کاری)',
  `created_by_user_id` INT UNSIGNED NOT NULL COMMENT 'ثبت‌کننده (نیرو یا مدیر)',
  `amount_toman` DECIMAL(15, 0) NOT NULL,
  `tx_type` ENUM('ADVANCE', 'ON_ACCOUNT', 'SALARY', 'PETTY_CASH', 'OTHER') NOT NULL,
  `tx_date` DATE NOT NULL,
  `shamsi_date` VARCHAR(10) NOT NULL,
  `description` VARCHAR(1000) NOT NULL,
  `status` ENUM('PENDING', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'PENDING',
  `reviewed_by_user_id` INT UNSIGNED NULL DEFAULT NULL,
  `reviewed_at` DATETIME NULL DEFAULT NULL,
  `manager_note` VARCHAR(500) NULL DEFAULT NULL,
  `idempotency_key` VARCHAR(64) NULL DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_fin_idempotency` (`idempotency_key`),
  KEY `idx_fin_status_date` (`status`, `tx_date`),
  KEY `idx_fin_shamsi` (`shamsi_date`),
  KEY `idx_fin_type` (`tx_type`),
  CONSTRAINT `fk_fin_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`),
  CONSTRAINT `fk_fin_creator` FOREIGN KEY (`created_by_user_id`) REFERENCES `users` (`id`),
  CONSTRAINT `fk_fin_reviewer` FOREIGN KEY (`reviewed_by_user_id`) REFERENCES `users` (`id`),
  CONSTRAINT `chk_fin_amount_positive` CHECK (`amount_toman` > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ۶. جدول تنظیمات قواعد کارکرد و اضافه‌کاری
CREATE TABLE IF NOT EXISTS `system_settings` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `shift_start_time` VARCHAR(5) NOT NULL DEFAULT '08:30' COMMENT 'ساعت شروع شیفت HH:MM',
  `shift_end_time` VARCHAR(5) NOT NULL DEFAULT '17:00' COMMENT 'ساعت پایان شیفت HH:MM',
  `grace_period_minutes` INT UNSIGNED NOT NULL DEFAULT 15 COMMENT 'فرجه مجاز تأخیر به دقیقه',
  `break_duration_minutes` INT UNSIGNED NOT NULL DEFAULT 30 COMMENT 'زمان استراحت روزانه به دقیقه',
  `working_days_json` VARCHAR(64) NOT NULL DEFAULT '[6,0,1,2,3,4]' COMMENT 'روزهای کاری هفته (۶=شنبه تا ۴=پنجشنبه، ۵=جمعه)',
  `overtime_start_time` VARCHAR(5) NOT NULL DEFAULT '17:00' COMMENT 'ساعت شروع محاسبه اضافه‌کاری عصر',
  `overtime_before_shift` TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'محاسبه حضور پیش از شروع شیفت به عنوان اضافه‌کاری',
  `mission_policy` ENUM('PAID_AS_WORK', 'SEPARATE_EXTRA') NOT NULL DEFAULT 'PAID_AS_WORK' COMMENT 'نحوه محاسبه مأموریت',
  `friday_holiday_policy` ENUM('ALL_OVERTIME', 'REGULAR_WORK', 'DISABLED') NOT NULL DEFAULT 'ALL_OVERTIME' COMMENT 'نحوه محاسبه کار در جمعه و تعطیلات رسمی',
  `official_holidays_json` TEXT NOT NULL COMMENT 'آرایه تاریخ‌های شمسی تعطیل رسمی به فرمت YYYY/MM/DD',
  `timezone` VARCHAR(64) NOT NULL DEFAULT 'Asia/Tehran',
  `hourly_rate_toman` DECIMAL(15, 0) NULL DEFAULT NULL COMMENT 'نرخ پایه ساعتی به تومان (صرفاً با تعیین مدیر)',
  `overtime_rate_toman` DECIMAL(15, 0) NULL DEFAULT NULL COMMENT 'نرخ هر ساعت اضافه‌کاری به تومان (صرفاً با تعیین مدیر)',
  `rules_confirmed_by_manager` TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'آیا قواعد کارکرد توسط مدیر بررسی و تأیید نهایی شده است',
  `effective_from_shamsi` VARCHAR(10) NOT NULL DEFAULT '1405/01/01' COMMENT 'تاریخ اعمال تنظیمات جدید برای جلوگیری از تغییر ناخواسته ماه‌های قبل',
  `updated_by_user_id` INT UNSIGNED NULL DEFAULT NULL,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ۷. جدول تاریخچه تنظیمات (برای حفظ محاسبات ماه‌های گذشته در صورت تغییر قواعد)
CREATE TABLE IF NOT EXISTS `system_settings_snapshots` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `effective_from_shamsi` VARCHAR(10) NOT NULL,
  `settings_json` JSON NOT NULL,
  `created_by_user_id` INT UNSIGNED NULL DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_snapshot_effective` (`effective_from_shamsi`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ۸. جدول لاگ ممیزی (Audit Logs) برای ثبت تمام عملیات حساس
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
