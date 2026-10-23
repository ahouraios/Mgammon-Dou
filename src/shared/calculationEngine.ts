import {
  AttendanceEventType,
  AttendanceLog,
  DailyAttendanceSummary,
  SystemSettings,
  WorkerLiveState,
  WorkerLiveStatus,
} from './types';
import {
  getDayOfWeekFromGregorian,
  getNowInTimezone,
  getPersianDayName,
  parseTimeToMinutes,
} from './jalali';

/**
 * بررسی و اعتبارسنجی عملیات مجاز بعدی بر اساس آخرین وضعیت تردد روز جاری
 * جلوگیری از ثبت شروع کار تکراری، پایان کار بدون شروع کار و تغییر وضعیت‌های نامعتبر
 */
export function getAllowedNextEvents(todayActiveLogs: AttendanceLog[]): AttendanceEventType[] {
  const sorted = [...todayActiveLogs]
    .filter((l) => !l.is_deleted)
    .sort((a, b) => a.recorded_time.localeCompare(b.recorded_time) || a.id - b.id);

  if (sorted.length === 0) {
    return ['WORK_START'];
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
      return ['WORK_START'];
    default:
      return ['WORK_START'];
  }
}

export function validateAttendanceSequence(
  existingLogs: AttendanceLog[],
  newEventType: AttendanceEventType,
  newEventTimeHHMMSS: string
): { valid: boolean; error?: string } {
  const active = [...existingLogs]
    .filter((l) => !l.is_deleted)
    .sort((a, b) => a.recorded_time.localeCompare(b.recorded_time) || a.id - b.id);

  if (active.length > 0) {
    const last = active[active.length - 1];
    if (newEventTimeHHMMSS < last.recorded_time) {
      return {
        valid: false,
        error: `ساعت ثبت جدید (${newEventTimeHHMMSS}) نمی‌تواند قبل از آخرین عملیات ثبت‌شده (${last.recorded_time}) باشد.`,
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
export function validateFullDayLogSequence(logs: Pick<AttendanceLog, 'event_type' | 'recorded_time'>[]): {
  valid: boolean;
  error?: string;
} {
  const sorted = [...logs].sort((a, b) => a.recorded_time.localeCompare(b.recorded_time));
  let state: 'IDLE' | 'WORKING' | 'MISSION' = 'IDLE';

  for (let i = 0; i < sorted.length; i++) {
    const ev = sorted[i];
    if (i > 0 && ev.recorded_time === sorted[i - 1].recorded_time && ev.event_type === sorted[i - 1].event_type) {
      return { valid: false, error: 'ثبت عملیات تکراری در یک زمان یکسان مجاز نیست.' };
    }
    if (state === 'IDLE') {
      if (ev.event_type !== 'WORK_START') {
        return { valid: false, error: 'هر نوبت کاری باید با «شروع کار» آغاز شود.' };
      }
      state = 'WORKING';
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
        return { valid: false, error: 'در حین مأموریت فقط ثبت «بازگشت از مأموریت» یا «پایان کار» مجاز است.' };
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
 * با پشتیبانی از ساعات کاری اختصاصی روز پنجشنبه
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
    .sort((a, b) => a.recorded_time.localeCompare(b.recorded_time) || a.id - b.id);

  const dayOfWeek = getDayOfWeekFromGregorian(workDate);
  const dayName = getPersianDayName(workDate);
  const isFriday = dayOfWeek === 5;
  const isOfficialHoliday = settings.official_holidays.includes(shamsiDate);
  const isHolidayOrFriday = isFriday || isOfficialHoliday;
  const isWorkingDay = settings.working_days.includes(dayOfWeek) && !isOfficialHoliday;

  const { shiftStartMin, overtimeStartMin } = getDayShiftSchedule(dayOfWeek, settings);
  const graceMin = settings.grace_period_minutes;

  if (activeLogs.length === 0) {
    return {
      work_date: workDate,
      shamsi_date: shamsiDate,
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

  // تشخیص تأخیر در روز کاری عادی
  let isLate = false;
  let lateMinutes = 0;
  if (isWorkingDay && firstInMin > shiftStartMin + graceMin) {
    isLate = true;
    lateMinutes = firstInMin - shiftStartMin;
  }

  // بررسی اینکه آیا آخرین رکورد بسته شده است (WORK_END)
  const isClosed = lastLog.event_type === 'WORK_END';
  const isIncomplete = !isClosed;

  // محاسبه بازه‌های حضور در محل کار و مأموریت
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

    if (isHolidayOrFriday) {
      if (settings.friday_holiday_policy === 'ALL_OVERTIME') {
        if (phase === 'WORK' || settings.mission_policy === 'PAID_AS_WORK') {
          overtimeRawMinutes += duration;
        }
      }
      return;
    }

    // محاسبه اضافه‌کاری بعد از ساعت شروع اضافه‌کاری (با لحاظ ساعت پنجشنبه در روز پنجشنبه)
    if (phase === 'WORK' || settings.mission_policy === 'PAID_AS_WORK') {
      if (endMin > overtimeStartMin) {
        const otStart = Math.max(startMin, overtimeStartMin);
        overtimeRawMinutes += Math.max(0, endMin - otStart);
      }
      if (settings.overtime_before_shift && startMin < shiftStartMin) {
        const otEnd = Math.min(endMin, shiftStartMin);
        overtimeRawMinutes += Math.max(0, otEnd - startMin);
      }
    }
  };

  for (const log of activeLogs) {
    const tMin = parseTimeToMinutes(log.recorded_time);
    if (log.event_type === 'WORK_START') {
      currentPhase = 'WORK';
      phaseStartMin = tMin;
    } else if (log.event_type === 'MISSION_START') {
      if (currentPhase === 'WORK') {
        accumulateInterval(phaseStartMin, tMin, 'WORK');
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
  if (isIncomplete && isToday && currentPhase !== 'IDLE') {
    const nowMin = parseTimeToMinutes(currentTimeHHMM);
    if (nowMin > phaseStartMin) {
      provisionalExtraMinutes = nowMin - phaseStartMin;
      if (isHolidayOrFriday && settings.friday_holiday_policy === 'ALL_OVERTIME') {
        provisionalOvertimeMinutes = provisionalExtraMinutes;
      } else if (!isHolidayOrFriday) {
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

  const effectiveGrossConfirmed =
    settings.mission_policy === 'PAID_AS_WORK'
      ? workSiteMinutes + missionMinutes
      : workSiteMinutes;

  const breakDeducted =
    isClosed && effectiveGrossConfirmed > 240
      ? Math.min(settings.break_duration_minutes, effectiveGrossConfirmed)
      : 0;

  const netWorkMinutes = isClosed ? Math.max(0, effectiveGrossConfirmed - breakDeducted) : 0;
  const confirmedOvertimeMinutes = isClosed ? overtimeRawMinutes : 0;

  const provisionalTotalMinutes = Math.max(
    0,
    effectiveGrossConfirmed + provisionalExtraMinutes - (effectiveGrossConfirmed + provisionalExtraMinutes > 240 ? settings.break_duration_minutes : 0)
  );

  let statusLabel = 'ثبت قطعی';
  if (isIncomplete) {
    statusLabel = isToday ? 'در حال کار (جاری)' : 'رکورد ناقص (نیازمند ثبت پایان کار)';
  } else if (isHolidayOrFriday) {
    statusLabel = 'کار در روز تعطیل';
  } else if (isLate) {
    statusLabel = 'حضور با تأخیر';
  }

  return {
    work_date: workDate,
    shamsi_date: shamsiDate,
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
    overtime_minutes: isToday && isIncomplete ? overtimeRawMinutes + provisionalOvertimeMinutes : confirmedOvertimeMinutes,
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
      if (settings.mission_policy === 'PAID_AS_WORK') {
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

      if (
        (todaySummary.is_holiday_or_friday && settings.friday_holiday_policy === 'ALL_OVERTIME') ||
        nowMin >= overtimeStartMin ||
        (settings.overtime_before_shift && nowMin < shiftStartMin)
      ) {
        isOvertimeActive = true;
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
  const baseSalaryToman = settings.base_salary_toman || 0;
  // اگر نرخ ساعتی مستقیم وارد شده باشد از آن استفاده می‌شود، وگرنه از تقسیم حقوق پایه بر ۱۹۱.۴ (یا ۱۹۲ ساعت کاری ماهانه) به دست می‌آید
  const effectiveHourlyRateToman =
    settings.hourly_rate_toman && settings.hourly_rate_toman > 0
      ? settings.hourly_rate_toman
      : baseSalaryToman > 0
        ? Math.round(baseSalaryToman / 192)
        : 0;

  let effectiveOvertimeHourlyRateToman = 0;
  if (settings.overtime_calc_mode === 'FIXED_RATE' && settings.overtime_rate_toman) {
    effectiveOvertimeHourlyRateToman = settings.overtime_rate_toman;
  } else if (settings.overtime_calc_mode === 'PERCENTAGE') {
    const pct = settings.overtime_percentage || 140;
    effectiveOvertimeHourlyRateToman = Math.round(effectiveHourlyRateToman * (pct / 100));
  } else if (settings.overtime_rate_toman) {
    effectiveOvertimeHourlyRateToman = settings.overtime_rate_toman;
  }

  const totalOvertimePayToman = Math.round(
    (totalOvertimeMinutes / 60) * effectiveOvertimeHourlyRateToman
  );

  return {
    baseSalaryToman,
    effectiveHourlyRateToman,
    effectiveOvertimeHourlyRateToman,
    totalOvertimePayToman,
  };
}
