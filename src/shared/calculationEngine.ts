import {
  AttendanceEventType,
  AttendanceLog,
  DailyAttendanceSummary,
  HistoricalWorkRecord,
  SystemSettings,
  WorkerLiveState,
  WorkerLiveStatus,
} from './types';
import {
  getDayOfWeekFromGregorian,
  getNowInTimezone,
  getPersianDayName,
  getShamsiMonthRange,
  gregorianToShamsi,
  isValidShamsiDate,
  isValidTimeHHMMOrHHMMSS,
  normalizeShamsiDate,
  pad2,
  parseTimeToMinutes,
  shamsiToGregorian,
  toEnglishDigits,
} from './jalali';

function normalizeTimeHHMMSS(raw: string): string {
  const clean = toEnglishDigits(String(raw || '')).trim();
  const parts = clean.split(':');
  if (parts.length === 2) {
    return `${parts[0].padStart(2, '0')}:${parts[1].padStart(2, '0')}:00`;
  }
  if (parts.length >= 3) {
    return `${parts[0].padStart(2, '0')}:${parts[1].padStart(2, '0')}:${parts[2].padStart(2, '0')}`;
  }
  return clean;
}

/**
 * بررسی و اعتبارسنجی عملیات مجاز بعدی بر اساس آخرین وضعیت تردد روز جاری
 * جلوگیری از ثبت شروع کار تکراری، پایان کار بدون شروع کار و تغییر وضعیت‌های نامعتبر
 * پشتیبانی از شروع مأموریت از ابتدای روز یا پس از شروع کار
 */
export function getAllowedNextEvents(todayActiveLogs: AttendanceLog[]): AttendanceEventType[] {
  const sorted = [...todayActiveLogs]
    .filter((l) => !l.is_deleted)
    .sort(
      (a, b) =>
        normalizeTimeHHMMSS(a.recorded_time).localeCompare(normalizeTimeHHMMSS(b.recorded_time)) ||
        a.id - b.id
    );

  if (sorted.length === 0) {
    return ['WORK_START', 'MISSION_START'];
  }

  const lastEvent = sorted[sorted.length - 1].event_type;

  switch (lastEvent) {
    case 'WORK_START':
      return ['MISSION_START', 'WORK_END'];
    case 'MISSION_START':
      return ['MISSION_END', 'WORK_END'];
    case 'MISSION_END':
      return ['MISSION_START', 'WORK_END'];
    case 'WORK_END':
      return ['WORK_START', 'MISSION_START'];
    default:
      return ['WORK_START', 'MISSION_START'];
  }
}

export function validateAttendanceSequence(
  existingLogs: AttendanceLog[],
  newEventType: AttendanceEventType,
  newEventTimeHHMMSS: string
): { valid: boolean; error?: string } {
  if (!isValidTimeHHMMOrHHMMSS(newEventTimeHHMMSS, true)) {
    return {
      valid: false,
      error: `فرمت ساعت واردشده (${newEventTimeHHMMSS}) معتبر نیست.`,
    };
  }

  const normNewTime = normalizeTimeHHMMSS(newEventTimeHHMMSS);

  const active = [...existingLogs]
    .filter((l) => !l.is_deleted)
    .sort(
      (a, b) =>
        normalizeTimeHHMMSS(a.recorded_time).localeCompare(normalizeTimeHHMMSS(b.recorded_time)) ||
        a.id - b.id
    );

  if (active.length > 0) {
    const last = active[active.length - 1];
    const lastNormTime = normalizeTimeHHMMSS(last.recorded_time);
    if (normNewTime < lastNormTime) {
      return {
        valid: false,
        error: `ساعت ثبت جدید (${newEventTimeHHMMSS}) نمی‌تواند قبل از آخرین عملیات ثبت‌شده (${last.recorded_time}) باشد.`,
      };
    }
    if (normNewTime === lastNormTime && newEventType === last.event_type) {
      return {
        valid: false,
        error: 'ثبت عملیات تکراری در یک زمان یکسان مجاز نیست.',
      };
    }
  }

  const allowed = getAllowedNextEvents(active);
  if (!allowed.includes(newEventType)) {
    const labels: Record<AttendanceEventType, string> = {
      WORK_START: 'شروع کار',
      MISSION_START: 'شروع مأموریت',
      MISSION_END: 'پایان مأموریت و بازگشت به محل کار',
      WORK_END: 'پایان کار',
    };
    const lastLabel = active.length > 0 ? labels[active[active.length - 1].event_type] : 'عدم ثبت ورود';
    return {
      valid: false,
      error: `ثبت «${labels[newEventType]}» در وضعیت فعلی (${lastLabel}) مجاز نیست.`,
    };
  }

  return { valid: true };
}

/**
 * اعتبارسنجی یک توالی کامل از رکوردهای یک روز (هنگام اصلاح یا حذف تردد توسط مدیر)
 */
export function validateFullDayLogSequence(
  logs: (Pick<AttendanceLog, 'event_type' | 'recorded_time'> & { id?: number })[]
): {
  valid: boolean;
  error?: string;
} {
  for (const l of logs) {
    if (!isValidTimeHHMMOrHHMMSS(l.recorded_time, true)) {
      return {
        valid: false,
        error: `فرمت ساعت (${l.recorded_time}) معتبر نیست. ساعت باید بین 00:00 تا 23:59 باشد.`,
      };
    }
  }

  const sorted = [...logs].sort(
    (a, b) =>
      normalizeTimeHHMMSS(a.recorded_time).localeCompare(normalizeTimeHHMMSS(b.recorded_time)) ||
      (a.id ?? 0) - (b.id ?? 0)
  );
  let state: 'IDLE' | 'WORKING' | 'MISSION' = 'IDLE';

  for (let i = 0; i < sorted.length; i++) {
    const ev = sorted[i];
    const evTime = normalizeTimeHHMMSS(ev.recorded_time);
    const prevTime = i > 0 ? normalizeTimeHHMMSS(sorted[i - 1].recorded_time) : '';

    if (i > 0 && evTime === prevTime && ev.event_type === sorted[i - 1].event_type) {
      return { valid: false, error: 'ثبت عملیات تکراری در یک زمان یکسان مجاز نیست.' };
    }
    if (state === 'IDLE') {
      if (ev.event_type === 'WORK_START') {
        state = 'WORKING';
      } else if (ev.event_type === 'MISSION_START') {
        state = 'MISSION';
      } else {
        return {
          valid: false,
          error: 'هر نوبت کاری باید با «شروع کار» یا «شروع مأموریت» آغاز شود.',
        };
      }
    } else if (state === 'WORKING') {
      if (ev.event_type === 'WORK_START') {
        return { valid: false, error: 'ثبت «شروع کار» تکراری پیش از پایان کار قبلی مجاز نیست.' };
      }
      if (ev.event_type === 'MISSION_END') {
        return { valid: false, error: 'ثبت «پایان مأموریت» بدون شروع مأموریت مجاز نیست.' };
      }
      if (ev.event_type === 'MISSION_START') {
        state = 'MISSION';
      } else if (ev.event_type === 'WORK_END') {
        state = 'IDLE';
      }
    } else if (state === 'MISSION') {
      if (ev.event_type === 'WORK_START' || ev.event_type === 'MISSION_START') {
        return {
          valid: false,
          error: 'در حین مأموریت فقط ثبت «بازگشت از مأموریت» یا «پایان کار» مجاز است.',
        };
      }
      if (ev.event_type === 'MISSION_END') {
        state = 'WORKING';
      } else if (ev.event_type === 'WORK_END') {
        state = 'IDLE';
      }
    }
  }

  return { valid: true };
}

/**
 * استخراج ساعات شیفت روز بر اساس اینکه روز پنجشنبه است یا سایر روزهای هفته
 */
export function getDayShiftSchedule(dayOfWeek: number, settings: SystemSettings): {
  shiftStartHHMM: string;
  shiftEndHHMM: string;
  overtimeStartHHMM: string;
  shiftStartMin: number;
  shiftEndMin: number;
  overtimeStartMin: number;
} {
  const isThursday = dayOfWeek === 4;
  const shiftStartHHMM = isThursday
    ? settings.thursday_shift_start_time || settings.shift_start_time
    : settings.shift_start_time;
  const shiftEndHHMM = isThursday
    ? settings.thursday_shift_end_time || settings.shift_end_time
    : settings.shift_end_time;
  const overtimeStartHHMM = isThursday
    ? settings.thursday_overtime_start_time || shiftEndHHMM
    : settings.overtime_start_time;

  return {
    shiftStartHHMM,
    shiftEndHHMM,
    overtimeStartHHMM,
    shiftStartMin: parseTimeToMinutes(shiftStartHHMM),
    shiftEndMin: parseTimeToMinutes(shiftEndHHMM),
    overtimeStartMin: parseTimeToMinutes(overtimeStartHHMM),
  };
}

/**
 * محاسبه دقیق کارکرد، تأخیر، مأموریت، کسر استراحت و اضافه‌کاری برای یک روز مشخص
 * با پشتیبانی از ساعات کاری اختصاصی روز پنجشنبه، مأموریت از ابتدای روز و سیاست‌های روز تعطیل
 */
export function calculateDailyAttendance(
  workDate: string,
  shamsiDate: string,
  dayLogs: AttendanceLog[],
  settings: SystemSettings,
  options?: {
    isToday?: boolean;
    currentTimeHHMM?: string;
  }
): DailyAttendanceSummary {
  const isToday = options?.isToday ?? false;
  const currentTimeHHMM = options?.currentTimeHHMM ?? '00:00';

  const activeLogs = [...dayLogs]
    .filter((l) => !l.is_deleted)
    .sort(
      (a, b) =>
        normalizeTimeHHMMSS(a.recorded_time).localeCompare(normalizeTimeHHMMSS(b.recorded_time)) ||
        a.id - b.id
    );

  const dayOfWeek = getDayOfWeekFromGregorian(workDate);
  const dayName = getPersianDayName(workDate);
  const isFriday = dayOfWeek === 5;
  const normShamsi = isValidShamsiDate(shamsiDate) ? normalizeShamsiDate(shamsiDate) : shamsiDate;
  const isOfficialHoliday = settings.official_holidays.some(
    (h) => (isValidShamsiDate(h) ? normalizeShamsiDate(h) : h) === normShamsi
  );
  const isHolidayOrFriday = isFriday || isOfficialHoliday;
  const isWorkingDay = settings.working_days.includes(dayOfWeek) && !isOfficialHoliday;
  const isHolidayWorkDisabled = isHolidayOrFriday && settings.friday_holiday_policy === 'DISABLED';

  const { shiftStartMin, overtimeStartMin } = getDayShiftSchedule(dayOfWeek, settings);
  const graceMin = settings.grace_period_minutes;

  if (activeLogs.length === 0) {
    return {
      work_date: workDate,
      shamsi_date: normShamsi,
      day_name: dayName,
      is_holiday_or_friday: isHolidayOrFriday,
      is_working_day: isWorkingDay,
      logs: [],
      first_in_time: null,
      last_out_time: null,
      is_incomplete: false,
      is_late: false,
      late_minutes: 0,
      gross_presence_minutes: 0,
      mission_minutes: 0,
      break_deducted_minutes: 0,
      net_work_minutes: 0,
      provisional_work_minutes: 0,
      overtime_minutes: 0,
      status_label: isWorkingDay ? 'غیبت / بدون ثبت' : 'تعطیل',
    };
  }

  const firstLog = activeLogs[0];
  const lastLog = activeLogs[activeLogs.length - 1];
  const firstInMin = parseTimeToMinutes(firstLog.recorded_time);

  // تشخیص تأخیر در روز کاری عادی (در صورتی که شروع روز با مأموریت نباشد یا سیاست مأموریت جزء کار باشد)
  let isLate = false;
  let lateMinutes = 0;
  if (isWorkingDay && firstInMin > shiftStartMin + graceMin) {
    isLate = true;
    lateMinutes = firstInMin - shiftStartMin;
  }

  // بررسی اینکه آیا آخرین رکورد بسته شده است (WORK_END)
  const isClosed = lastLog.event_type === 'WORK_END';
  const isIncomplete = !isClosed;

  // محاسبه بازه‌های حضور در محل کار و مأموریت بدون دوباره‌شماری
  let workSiteMinutes = 0;
  let missionMinutes = 0;
  let overtimeRawMinutes = 0;

  let currentPhase: 'IDLE' | 'WORK' | 'MISSION' = 'IDLE';
  let phaseStartMin = 0;

  const accumulateInterval = (startMin: number, endMin: number, phase: 'WORK' | 'MISSION') => {
    if (endMin <= startMin) return;
    const duration = endMin - startMin;
    if (phase === 'WORK') {
      workSiteMinutes += duration;
    } else if (phase === 'MISSION') {
      missionMinutes += duration;
    }

    if (isHolidayWorkDisabled) {
      return;
    }

    const isPayablePhase = phase === 'WORK' || settings.mission_policy === 'PAID_AS_WORK';
    if (!isPayablePhase) {
      return;
    }

    if (isHolidayOrFriday && settings.friday_holiday_policy === 'ALL_OVERTIME') {
      overtimeRawMinutes += duration;
      return;
    }

    // در روزهای عادی یا زمانی که سیاست تعطیلات REGULAR_WORK است:
    // محاسبه اضافه‌کاری بعد از ساعت شروع اضافه‌کاری (با لحاظ ساعت پنجشنبه در روز پنجشنبه) و قبل از شیفت (در صورت فعال بودن)
    if (endMin > overtimeStartMin) {
      const otStart = Math.max(startMin, overtimeStartMin);
      overtimeRawMinutes += Math.max(0, endMin - otStart);
    }
    if (settings.overtime_before_shift && startMin < shiftStartMin) {
      const otEnd = Math.min(endMin, shiftStartMin);
      overtimeRawMinutes += Math.max(0, otEnd - startMin);
    }
  };

  for (const log of activeLogs) {
    const tMin = parseTimeToMinutes(log.recorded_time);
    if (log.event_type === 'WORK_START') {
      if (currentPhase === 'WORK' || currentPhase === 'MISSION') {
        accumulateInterval(phaseStartMin, tMin, currentPhase);
      }
      currentPhase = 'WORK';
      phaseStartMin = tMin;
    } else if (log.event_type === 'MISSION_START') {
      if (currentPhase === 'WORK' || currentPhase === 'MISSION') {
        accumulateInterval(phaseStartMin, tMin, currentPhase);
      }
      currentPhase = 'MISSION';
      phaseStartMin = tMin;
    } else if (log.event_type === 'MISSION_END') {
      if (currentPhase === 'MISSION') {
        accumulateInterval(phaseStartMin, tMin, 'MISSION');
      }
      currentPhase = 'WORK';
      phaseStartMin = tMin;
    } else if (log.event_type === 'WORK_END') {
      if (currentPhase === 'WORK' || currentPhase === 'MISSION') {
        accumulateInterval(phaseStartMin, tMin, currentPhase);
      }
      currentPhase = 'IDLE';
    }
  }

  let provisionalExtraMinutes = 0;
  let provisionalOvertimeMinutes = 0;
  if (isIncomplete && isToday && currentPhase !== 'IDLE' && !isHolidayWorkDisabled) {
    const nowMin = parseTimeToMinutes(currentTimeHHMM);
    const isPayablePhase = currentPhase === 'WORK' || settings.mission_policy === 'PAID_AS_WORK';
    if (nowMin > phaseStartMin && isPayablePhase) {
      provisionalExtraMinutes = nowMin - phaseStartMin;
      if (isHolidayOrFriday && settings.friday_holiday_policy === 'ALL_OVERTIME') {
        provisionalOvertimeMinutes = provisionalExtraMinutes;
      } else {
        if (nowMin > overtimeStartMin) {
          const otStart = Math.max(phaseStartMin, overtimeStartMin);
          provisionalOvertimeMinutes += Math.max(0, nowMin - otStart);
        }
        if (settings.overtime_before_shift && phaseStartMin < shiftStartMin) {
          const otEnd = Math.min(nowMin, shiftStartMin);
          provisionalOvertimeMinutes += Math.max(0, otEnd - phaseStartMin);
        }
      }
    }
  }

  const effectiveGrossConfirmed = isHolidayWorkDisabled
    ? 0
    : settings.mission_policy === 'PAID_AS_WORK'
      ? workSiteMinutes + missionMinutes
      : workSiteMinutes;

  const breakDeducted =
    isClosed && !isHolidayWorkDisabled && effectiveGrossConfirmed > 240
      ? Math.min(settings.break_duration_minutes, effectiveGrossConfirmed)
      : 0;

  const netWorkMinutes =
    isClosed && !isHolidayWorkDisabled ? Math.max(0, effectiveGrossConfirmed - breakDeducted) : 0;

  const confirmedOvertimeMinutes =
    isClosed && !isHolidayWorkDisabled
      ? isHolidayOrFriday && settings.friday_holiday_policy === 'ALL_OVERTIME'
        ? Math.min(overtimeRawMinutes, netWorkMinutes)
        : overtimeRawMinutes
      : 0;

  const provisionalGross = effectiveGrossConfirmed + provisionalExtraMinutes;
  const provisionalTotalMinutes = isHolidayWorkDisabled
    ? 0
    : Math.max(
        0,
        provisionalGross - (provisionalGross > 240 ? settings.break_duration_minutes : 0)
      );

  let statusLabel = 'ثبت قطعی';
  if (isIncomplete) {
    statusLabel = isToday ? 'در حال کار (جاری)' : 'رکورد ناقص (نیازمند ثبت پایان کار)';
  } else if (isHolidayWorkDisabled) {
    statusLabel = 'تعطیل (کار در تعطیلات غیرفعال)';
  } else if (isHolidayOrFriday) {
    statusLabel = 'کار در روز تعطیل';
  } else if (isLate) {
    statusLabel = 'حضور با تأخیر';
  }

  return {
    work_date: workDate,
    shamsi_date: normShamsi,
    day_name: dayName,
    is_holiday_or_friday: isHolidayOrFriday,
    is_working_day: isWorkingDay,
    logs: activeLogs,
    first_in_time: firstLog.recorded_time.slice(0, 5),
    last_out_time: isClosed ? lastLog.recorded_time.slice(0, 5) : null,
    is_incomplete: isIncomplete,
    is_late: isLate,
    late_minutes: lateMinutes,
    gross_presence_minutes: isClosed ? effectiveGrossConfirmed : 0,
    mission_minutes: missionMinutes,
    break_deducted_minutes: breakDeducted,
    net_work_minutes: netWorkMinutes,
    provisional_work_minutes: isToday && isIncomplete ? provisionalTotalMinutes : netWorkMinutes,
    overtime_minutes:
      isToday && isIncomplete
        ? overtimeRawMinutes + provisionalOvertimeMinutes
        : confirmedOvertimeMinutes,
    status_label: statusLabel,
  };
}

/**
 * تعیین وضعیت لحظه‌ای نیروی کاری برای نمایش در کادر وضعیت امید میثمی
 */
export function evaluateWorkerLiveState(
  todayLogs: AttendanceLog[],
  settings: SystemSettings,
  referenceDate: Date = new Date()
): WorkerLiveState {
  const nowInfo = getNowInTimezone(settings.timezone, referenceDate);
  const nowMin = parseTimeToMinutes(nowInfo.timeHHMM);
  const dayOfWeek = getDayOfWeekFromGregorian(nowInfo.workDate);
  const { shiftStartHHMM, shiftStartMin, shiftEndMin, overtimeStartMin } = getDayShiftSchedule(
    dayOfWeek,
    settings
  );
  const graceMin = settings.grace_period_minutes;

  const todaySummary = calculateDailyAttendance(
    nowInfo.workDate,
    nowInfo.shamsiDate,
    todayLogs,
    settings,
    {
      isToday: true,
      currentTimeHHMM: nowInfo.timeHHMM,
    }
  );

  const activeLogs = todaySummary.logs;
  const allowedNext = getAllowedNextEvents(activeLogs);
  const lastEvent = activeLogs.length > 0 ? activeLogs[activeLogs.length - 1] : null;

  let status: WorkerLiveStatus = 'FINISHED';
  let statusText = 'پایان کار / خارج از شیفت';
  let statusDetail = 'هنوز ترددی برای امروز ثبت نشده است';
  let isOvertimeActive = false;

  if (!lastEvent) {
    if (
      todaySummary.is_working_day &&
      nowMin > shiftStartMin + graceMin &&
      nowMin <= shiftEndMin + 120
    ) {
      status = 'ABSENT';
      statusText = 'غیبت (عدم ثبت ورود)';
      statusDetail = `ساعت شروع شیفت ${shiftStartHHMM} بوده و تاکنون ورودی ثبت نشده است`;
    } else {
      status = 'FINISHED';
      statusText = todaySummary.is_working_day ? 'خارج از شیفت (پیش از شروع)' : 'روز غیرکاری / تعطیل';
      statusDetail = todaySummary.is_working_day
        ? `شروع شیفت امروز ساعت ${shiftStartHHMM}`
        : 'امروز در تقویم کاری سامانه تعطیل است';
    }
  } else {
    if (lastEvent.event_type === 'WORK_END') {
      status = 'FINISHED';
      statusText = 'پایان کار';
      statusDetail = `پایان کار در ساعت ${lastEvent.recorded_time.slice(0, 5)} ثبت شده است`;
      isOvertimeActive = false;
    } else if (lastEvent.event_type === 'MISSION_START') {
      status = 'MISSION';
      statusText = 'در مأموریت';
      statusDetail = `شروع مأموریت از ساعت ${lastEvent.recorded_time.slice(0, 5)}`;
      if (
        settings.mission_policy === 'PAID_AS_WORK' &&
        !(todaySummary.is_holiday_or_friday && settings.friday_holiday_policy === 'DISABLED')
      ) {
        if (
          (todaySummary.is_holiday_or_friday && settings.friday_holiday_policy === 'ALL_OVERTIME') ||
          nowMin >= overtimeStartMin ||
          (settings.overtime_before_shift && nowMin < shiftStartMin)
        ) {
          isOvertimeActive = true;
        }
      }
    } else {
      if (todaySummary.is_late) {
        status = 'LATE';
        statusText = 'حضور با تأخیر';
        statusDetail = `ورود ساعت ${todaySummary.first_in_time} (${todaySummary.late_minutes} دقیقه تأخیر نسبت به ${shiftStartHHMM})`;
      } else {
        status = 'PRESENT';
        statusText = 'حاضر در محل کار';
        statusDetail = `ورود در ساعت ${todaySummary.first_in_time}`;
      }

      if (!(todaySummary.is_holiday_or_friday && settings.friday_holiday_policy === 'DISABLED')) {
        if (
          (todaySummary.is_holiday_or_friday && settings.friday_holiday_policy === 'ALL_OVERTIME') ||
          nowMin >= overtimeStartMin ||
          (settings.overtime_before_shift && nowMin < shiftStartMin)
        ) {
          isOvertimeActive = true;
        }
      }
    }
  }

  return {
    status,
    status_text: statusText,
    status_detail: statusDetail,
    is_overtime_active: isOvertimeActive,
    last_event: lastEvent,
    allowed_next_events: allowedNext,
    today_summary: todaySummary,
  };
}

/**
 * محاسبه نرخ ساعتی و مبلغ اضافه‌کاری بر اساس تنظیمات مدیر (مبلغ ثابت یا درصدی از حقوق پایه)
 * واحد تمام خروجی‌ها و ورودی‌ها: تومان (عدد صحیح گردشده با Math.round)
 */
export function calculateSalaryAndOvertimeRates(
  settings: SystemSettings,
  totalOvertimeMinutes: number
): {
  baseSalaryToman: number;
  effectiveHourlyRateToman: number;
  effectiveOvertimeHourlyRateToman: number;
  totalOvertimePayToman: number;
} {
  const baseSalaryToman =
    settings.base_salary_toman && settings.base_salary_toman > 0
      ? Math.round(settings.base_salary_toman)
      : 0;
  const safeOvertimeMinutes = Math.max(0, Number(totalOvertimeMinutes) || 0);

  // اگر نرخ ساعتی مستقیم وارد شده باشد از آن استفاده می‌شود، وگرنه از تقسیم حقوق پایه بر ۱۹۲ ساعت کاری ماهانه به دست می‌آید
  const effectiveHourlyRateToman =
    settings.hourly_rate_toman && settings.hourly_rate_toman > 0
      ? Math.round(settings.hourly_rate_toman)
      : baseSalaryToman > 0
        ? Math.round(baseSalaryToman / 192)
        : 0;

  let effectiveOvertimeHourlyRateToman = 0;
  if (settings.overtime_calc_mode === 'FIXED_RATE' && settings.overtime_rate_toman && settings.overtime_rate_toman > 0) {
    effectiveOvertimeHourlyRateToman = Math.round(settings.overtime_rate_toman);
  } else if (settings.overtime_calc_mode === 'PERCENTAGE') {
    const pct = settings.overtime_percentage && settings.overtime_percentage > 0 ? settings.overtime_percentage : 140;
    effectiveOvertimeHourlyRateToman = Math.round(effectiveHourlyRateToman * (pct / 100));
  } else if (settings.overtime_rate_toman && settings.overtime_rate_toman > 0) {
    effectiveOvertimeHourlyRateToman = Math.round(settings.overtime_rate_toman);
  }

  const totalOvertimePayToman = Math.round(
    (safeOvertimeMinutes / 60) * effectiveOvertimeHourlyRateToman
  );

  return {
    baseSalaryToman,
    effectiveHourlyRateToman,
    effectiveOvertimeHourlyRateToman,
    totalOvertimePayToman,
  };
}

/**
 * انتخاب نسخه تنظیمات مؤثر برای یک تاریخ شمسی مشخص با توجه به تاریخچه اسنپ‌شات‌ها
 */
export function resolveEffectiveSettingsForShamsiDate(
  targetShamsiDate: string,
  currentSettings: SystemSettings,
  snapshots: { effective_from_shamsi: string; settings: SystemSettings }[] = []
): SystemSettings {
  if (!targetShamsiDate || !isValidShamsiDate(targetShamsiDate)) {
    return currentSettings;
  }
  const normTarget = normalizeShamsiDate(targetShamsiDate);
  const currentEff = isValidShamsiDate(currentSettings.effective_from_shamsi)
    ? normalizeShamsiDate(currentSettings.effective_from_shamsi)
    : '1400/01/01';

  if (normTarget >= currentEff || snapshots.length === 0) {
    return currentSettings;
  }

  const sortedSnaps = [...snapshots].sort((a, b) =>
    normalizeShamsiDate(b.effective_from_shamsi).localeCompare(
      normalizeShamsiDate(a.effective_from_shamsi)
    )
  );

  for (const snap of sortedSnaps) {
    const snapEff = isValidShamsiDate(snap.effective_from_shamsi)
      ? normalizeShamsiDate(snap.effective_from_shamsi)
      : '1400/01/01';
    if (snapEff <= normTarget) {
      return {
        ...currentSettings,
        ...snap.settings,
        banner_bg_url: currentSettings.banner_bg_url,
      };
    }
  }

  // اگر تاریخ هدف قبل از تمام اسنپ‌شات‌ها باشد، قدیمی‌ترین اسنپ‌شات ثبت‌شده ملاک دوره گذشته است
  const oldestSnap = sortedSnaps[sortedSnaps.length - 1];
  return {
    ...currentSettings,
    ...oldestSnap.settings,
    banner_bg_url: currentSettings.banner_bg_url,
  };
}

/**
 * محاسبه جامع دوره حقوقی ماهانه یا بازه‌ای با پشتیبانی از:
 * - طول دقیق ماه شمسی (۲۹، ۳۰، ۳۱ روزه و اسفند کبیسه)
 * - استخدام در میانه ماه (collaboration_start_shamsi) و خروج در میانه ماه (collaboration_end_shamsi)
 * - تغییر نرخ حقوق یا اضافه‌کاری در میانه ماه از طریق snapshots بدون تغییر بی‌صدای دوره‌های قبل
 * - جداسازی دقیق ساعت کار عادی از اضافه‌کاری برای جلوگیری از دوباره‌شماری
 */
export function calculateMonthlyPayrollPeriod(params: {
  jy: number;
  jm: number;
  logs: AttendanceLog[];
  historicalRecords?: HistoricalWorkRecord[];
  currentSettings: SystemSettings;
  snapshots?: { effective_from_shamsi: string; settings: SystemSettings }[];
  collaborationStartShamsi?: string | null;
  collaborationEndShamsi?: string | null;
}): {
  monthRange: {
    startShamsi: string;
    endShamsi: string;
    monthLength: number;
    isLeapYear: boolean;
  };
  effectiveContractStartShamsi: string;
  effectiveContractEndShamsi: string;
  activeContractCalendarDays: number;
  totalConfirmedWorkDays: number;
  incompleteDaysCount: number;
  totalNetWorkMinutes: number;
  totalRegularWorkMinutes: number;
  totalOvertimeMinutes: number;
  proratedBaseSalaryToman: number;
  earnedRegularWorkToman: number;
  earnedOvertimeToman: number;
  dailySummaries: DailyAttendanceSummary[];
} {
  const {
    jy,
    jm,
    logs,
    historicalRecords = [],
    currentSettings,
    snapshots = [],
    collaborationStartShamsi,
    collaborationEndShamsi,
  } = params;

  const monthRange = getShamsiMonthRange(jy, jm);
  const rawCollabStart =
    collaborationStartShamsi || currentSettings.collaboration_start_shamsi || '1400/01/01';
  const normCollabStart = isValidShamsiDate(rawCollabStart)
    ? normalizeShamsiDate(rawCollabStart)
    : '1400/01/01';
  const normCollabEnd =
    collaborationEndShamsi && isValidShamsiDate(collaborationEndShamsi)
      ? normalizeShamsiDate(collaborationEndShamsi)
      : '1499/12/29';

  const effectiveContractStartShamsi =
    normCollabStart > monthRange.startShamsi ? normCollabStart : monthRange.startShamsi;
  const effectiveContractEndShamsi =
    normCollabEnd < monthRange.endShamsi ? normCollabEnd : monthRange.endShamsi;

  let activeContractCalendarDays = 0;
  let exactProratedBaseSalary = 0;

  if (effectiveContractStartShamsi <= effectiveContractEndShamsi) {
    const startDay = Number(effectiveContractStartShamsi.slice(8, 10));
    const endDay = Number(effectiveContractEndShamsi.slice(8, 10));
    activeContractCalendarDays = Math.max(0, endDay - startDay + 1);

    for (let d = startDay; d <= endDay; d++) {
      const dayShamsi = `${jy}/${pad2(jm)}/${pad2(d)}`;
      const effSet = resolveEffectiveSettingsForShamsiDate(dayShamsi, currentSettings, snapshots);
      const dayBaseSalary =
        effSet.base_salary_toman && effSet.base_salary_toman > 0 ? effSet.base_salary_toman : 0;
      exactProratedBaseSalary += dayBaseSalary / monthRange.monthLength;
    }
  }

  const proratedBaseSalaryToman = Math.round(exactProratedBaseSalary);

  const byDate = new Map<string, AttendanceLog[]>();
  for (const l of logs) {
    if (l.is_deleted) continue;
    const normDate = isValidShamsiDate(l.shamsi_date)
      ? normalizeShamsiDate(l.shamsi_date)
      : gregorianToShamsi(l.work_date);
    if (normDate < effectiveContractStartShamsi || normDate > effectiveContractEndShamsi) {
      continue;
    }
    const workDate = l.work_date || shamsiToGregorian(normDate);
    const list = byDate.get(workDate) || [];
    list.push({ ...l, shamsi_date: normDate, work_date: workDate });
    byDate.set(workDate, list);
  }

  let totalConfirmedWorkDays = 0;
  let incompleteDaysCount = 0;
  let totalNetWorkMinutes = 0;
  let totalRegularWorkMinutes = 0;
  let totalOvertimeMinutes = 0;
  let exactEarnedRegularToman = 0;
  let exactEarnedOvertimeToman = 0;

  const dailySummaries: DailyAttendanceSummary[] = [];
  const confirmedShamsiDates = new Set<string>();

  for (const [workDate, dayLogs] of byDate.entries()) {
    const shamsiDate = dayLogs[0]?.shamsi_date || gregorianToShamsi(workDate);
    const effSettings = resolveEffectiveSettingsForShamsiDate(shamsiDate, currentSettings, snapshots);
    const summary = calculateDailyAttendance(workDate, shamsiDate, dayLogs, effSettings, {
      isToday: false,
    });
    dailySummaries.push(summary);

    if (summary.is_incomplete) {
      incompleteDaysCount += 1;
    } else if (summary.logs.length > 0) {
      confirmedShamsiDates.add(summary.shamsi_date);
      totalConfirmedWorkDays += 1;
      totalNetWorkMinutes += summary.net_work_minutes;
      totalOvertimeMinutes += summary.overtime_minutes;

      const dayRegularMins = Math.max(0, summary.net_work_minutes - summary.overtime_minutes);
      totalRegularWorkMinutes += dayRegularMins;

      const rates = calculateSalaryAndOvertimeRates(effSettings, summary.overtime_minutes);
      exactEarnedRegularToman += (dayRegularMins / 60) * rates.effectiveHourlyRateToman;
      exactEarnedOvertimeToman += (summary.overtime_minutes / 60) * rates.effectiveOvertimeHourlyRateToman;
    }
  }

  for (const rec of historicalRecords) {
    if (rec.status !== 'APPROVED') continue;
    const normRecDate = isValidShamsiDate(rec.shamsi_date)
      ? normalizeShamsiDate(rec.shamsi_date)
      : '';
    if (
      !normRecDate ||
      normRecDate < effectiveContractStartShamsi ||
      normRecDate > effectiveContractEndShamsi
    ) {
      continue;
    }
    if (rec.work_days_count === 1 && confirmedShamsiDates.has(normRecDate)) {
      continue;
    }
    const effSettings = resolveEffectiveSettingsForShamsiDate(
      normRecDate,
      currentSettings,
      snapshots
    );
    const rates = calculateSalaryAndOvertimeRates(effSettings, rec.overtime_minutes);

    totalConfirmedWorkDays += rec.work_days_count;
    totalNetWorkMinutes += rec.net_work_minutes;
    totalRegularWorkMinutes += rec.net_work_minutes;
    totalOvertimeMinutes += rec.overtime_minutes;
    exactEarnedRegularToman += (rec.net_work_minutes / 60) * rates.effectiveHourlyRateToman;
    exactEarnedOvertimeToman += (rec.overtime_minutes / 60) * rates.effectiveOvertimeHourlyRateToman;
  }

  return {
    monthRange,
    effectiveContractStartShamsi,
    effectiveContractEndShamsi,
    activeContractCalendarDays,
    totalConfirmedWorkDays,
    incompleteDaysCount,
    totalNetWorkMinutes,
    totalRegularWorkMinutes,
    totalOvertimeMinutes,
    proratedBaseSalaryToman,
    earnedRegularWorkToman: Math.round(exactEarnedRegularToman),
    earnedOvertimeToman: Math.round(exactEarnedOvertimeToman),
    dailySummaries: dailySummaries.sort((a, b) => b.work_date.localeCompare(a.work_date)),
  };
}

