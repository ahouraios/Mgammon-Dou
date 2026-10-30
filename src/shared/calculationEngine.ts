import {
  AbsenceDeductionUnit,
  AttendanceEventType,
  AttendanceLog,
  DailyAttendanceSummary,
  FinancialTransaction,
  HistoricalWorkRecord,
  LateArrivalDisposition,
  LateDeductionUnit,
  SystemSettings,
  WorkerLiveState,
  WorkerLiveStatus,
} from './types';
import {
  getDayOfWeekFromGregorian,
  getNowInTimezone,
  getPersianDayName,
  getShamsiMonthDays,
  getShamsiMonthRange,
  gregorianToShamsi,
  isValidShamsiDate,
  isValidTimeHHMMOrHHMMSS,
  normalizeShamsiDate,
  pad2,
  parseTimeToMinutes,
  PERSIAN_MONTHS,
  shamsiToGregorian,
  toEnglishDigits,
  toPersianDigits,
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
  const firstWorkStartLog =
    activeLogs.find((l) => l.event_type === 'WORK_START') || firstLog;

  // تشخیص تأخیر خام در روز کاری عادی (نسبت به ساعت شروع شیفت + حد مجاز تأخیر)
  let rawLateMinutes = 0;
  if (isWorkingDay && firstInMin > shiftStartMin + graceMin) {
    rawLateMinutes = firstInMin - shiftStartMin;
  }

  const rawLateStatus = firstWorkStartLog.late_status;
  const effectiveLateStatus: LateArrivalDisposition =
    rawLateStatus && rawLateStatus !== 'NONE'
      ? rawLateStatus
      : rawLateMinutes > 0
        ? 'PENDING'
        : 'NONE';

  let isLate = rawLateMinutes > 0;
  let lateMinutes = rawLateMinutes;

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

  let netWorkMinutes =
    isClosed && !isHolidayWorkDisabled ? Math.max(0, effectiveGrossConfirmed - breakDeducted) : 0;

  let confirmedOvertimeMinutes =
    isClosed && !isHolidayWorkDisabled
      ? isHolidayOrFriday && settings.friday_holiday_policy === 'ALL_OVERTIME'
        ? Math.min(overtimeRawMinutes, netWorkMinutes)
        : overtimeRawMinutes
      : 0;

  let lateDeductionToman = 0;
  const deductionRates = calculateLateAndAbsenceRates(settings);

  if (effectiveLateStatus === 'EXCUSED') {
    isLate = false;
    lateMinutes = 0;
    lateDeductionToman = 0;
  } else if (effectiveLateStatus === 'DEDUCT_LEAVE') {
    isLate = false;
    lateMinutes = rawLateMinutes;
    lateDeductionToman = 0;
  } else if (effectiveLateStatus === 'APPROVED_DELAY') {
    isLate = true;
    lateMinutes = rawLateMinutes;
    lateDeductionToman =
      deductionRates.lateUnit === 'HOUR'
        ? Math.round((rawLateMinutes / 60) * deductionRates.effectiveLateRatePerUnitToman)
        : Math.round(rawLateMinutes * deductionRates.effectiveLateRatePerUnitToman);
  } else if (effectiveLateStatus === 'ABSENCE') {
    isLate = true;
    lateMinutes = rawLateMinutes;
    netWorkMinutes = 0;
    confirmedOvertimeMinutes = 0;
    lateDeductionToman = deductionRates.effectiveDailyAbsenceRateToman;
  } else if (effectiveLateStatus === 'CUSTOM') {
    isLate = true;
    lateMinutes = rawLateMinutes;
    lateDeductionToman = Math.max(
      0,
      Math.round(Number(firstWorkStartLog.custom_deduction_toman || 0))
    );
  }

  const provisionalGross = effectiveGrossConfirmed + provisionalExtraMinutes;
  const provisionalTotalMinutes =
    isHolidayWorkDisabled || effectiveLateStatus === 'ABSENCE'
      ? 0
      : Math.max(
          0,
          provisionalGross - (provisionalGross > 240 ? settings.break_duration_minutes : 0)
        );

  let statusLabel = 'ثبت قطعی';
  if (effectiveLateStatus === 'ABSENCE') {
    statusLabel = 'ثبت غیبت (تصمیم مدیر)';
  } else if (isIncomplete) {
    statusLabel = isToday ? 'در حال کار (جاری)' : 'رکورد ناقص (نیازمند ثبت پایان کار)';
  } else if (isHolidayWorkDisabled) {
    statusLabel = 'تعطیل (کار در تعطیلات غیرفعال)';
  } else if (isHolidayOrFriday) {
    statusLabel = 'کار در روز تعطیل';
  } else if (effectiveLateStatus === 'EXCUSED') {
    statusLabel = 'ثبت بدون تأخیر (تأیید مدیر)';
  } else if (effectiveLateStatus === 'DEDUCT_LEAVE') {
    statusLabel = 'کسر از مرخصی (بابت تأخیر)';
  } else if (effectiveLateStatus === 'APPROVED_DELAY') {
    statusLabel = 'حضور با تأخیر (کسر تأخیر)';
  } else if (effectiveLateStatus === 'CUSTOM') {
    statusLabel = 'حضور با تأخیر (تعیین تکلیف مدیر)';
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
    raw_late_minutes: rawLateMinutes,
    late_minutes: lateMinutes,
    late_status: effectiveLateStatus,
    late_reason: firstWorkStartLog.late_reason || firstWorkStartLog.note || null,
    manager_late_note: firstWorkStartLog.manager_late_note || null,
    late_deduction_toman: lateDeductionToman,
    custom_deduction_toman:
      firstWorkStartLog.custom_deduction_toman != null
        ? Number(firstWorkStartLog.custom_deduction_toman)
        : null,
    late_reviewed_at: firstWorkStartLog.late_reviewed_at || null,
    is_late_seen_by_worker:
      firstWorkStartLog.is_late_seen_by_worker !== undefined
        ? Boolean(firstWorkStartLog.is_late_seen_by_worker)
        : true,
    first_in_log_id: firstWorkStartLog.id || null,
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

export const STANDARD_MONTHLY_WORK_DAYS = 26;
export const STANDARD_DAILY_WORK_HOURS = 8;
export const STANDARD_MONTHLY_WORK_HOURS =
  STANDARD_MONTHLY_WORK_DAYS * STANDARD_DAILY_WORK_HOURS; // 208 ساعت در ماه کاری ۲۶ روزه

/**
 * استخراج کلید دوره ماهانه (پیش‌فرض ۱۵ام هر ماه تا ۱۵ام ماه بعد) برای یک تاریخ شمسی
 */
export function getMonthlyCycleKeyForShamsiDate(
  shamsiDate: string,
  anchorDay = 15
): string {
  if (!shamsiDate || !isValidShamsiDate(shamsiDate)) {
    return '1405/06/15';
  }
  const norm = normalizeShamsiDate(shamsiDate);
  const [jy, jm, jd] = norm.split('/').map(Number);
  const safeAnchor = Math.min(29, Math.max(1, Math.round(Number(anchorDay) || 15)));
  if (jd >= safeAnchor) {
    return `${jy}/${pad2(jm)}/${pad2(safeAnchor)}`;
  }
  const prevJm = jm === 1 ? 12 : jm - 1;
  const prevJy = jm === 1 ? jy - 1 : jy;
  return `${prevJy}/${pad2(prevJm)}/${pad2(safeAnchor)}`;
}

/**
 * محاسبه نرخ ساعتی و مبلغ اضافه‌کاری بر اساس تنظیمات مدیر (مبلغ ثابت یا درصدی از حقوق پایه)
 * ماه کاری استاندارد: ۲۶ روز کاری (معادل ۲۰۸ ساعت کار عادی در ماه)
 * واحد تمام خروجی‌ها و ورودی‌ها: تومان (عدد صحیح گردشده با Math.round)
 */
export function calculateSalaryAndOvertimeRates(
  settings: SystemSettings,
  totalOvertimeMinutes: number
): {
  baseSalaryToman: number;
  dailyBaseRateToman: number;
  effectiveHourlyRateToman: number;
  effectiveOvertimeHourlyRateToman: number;
  totalOvertimePayToman: number;
} {
  const baseSalaryToman =
    settings.base_salary_toman && settings.base_salary_toman > 0
      ? Math.round(settings.base_salary_toman)
      : 0;
  const safeOvertimeMinutes = Math.max(0, Number(totalOvertimeMinutes) || 0);

  const dailyBaseRateToman =
    baseSalaryToman > 0 ? Math.round(baseSalaryToman / STANDARD_MONTHLY_WORK_DAYS) : 0;

  // اگر نرخ ساعتی مستقیم وارد شده باشد از آن استفاده می‌شود، وگرنه از تقسیم حقوق پایه بر ۲۰۸ ساعت (۲۶ روز کاری × ۸ ساعت) به دست می‌آید
  const effectiveHourlyRateToman =
    settings.hourly_rate_toman && settings.hourly_rate_toman > 0
      ? Math.round(settings.hourly_rate_toman)
      : baseSalaryToman > 0
        ? Math.round(baseSalaryToman / STANDARD_MONTHLY_WORK_HOURS)
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
    dailyBaseRateToman,
    effectiveHourlyRateToman,
    effectiveOvertimeHourlyRateToman,
    totalOvertimePayToman,
  };
}

/**
 * محاسبه نرخ‌های کسر بابت تأخیر در ورود و غیبت روزانه/ساعتی
 * پیش‌فرض بر اساس قانون کار (ماه کاری ۲۶ روزه = ۲۰۸ ساعت در ماه):
 * - نرخ پیش‌فرض هر ساعت تأخیر یا غیبت ساعتی: مزد یک ساعت کاری عادی (حقوق پایه تقسیم بر ۲۰۸)
 * - نرخ پیش‌فرض هر دقیقه تأخیر: مزد یک دقیقه کاری عادی (نرخ ساعتی تقسیم بر ۶۰)
 * - نرخ پیش‌فرض یک روز غیبت: مزد یک روز کاری (حقوق پایه تقسیم بر ۲۶)
 */
export function calculateLateAndAbsenceRates(settings: SystemSettings): {
  lateUnit: LateDeductionUnit;
  absenceUnit: AbsenceDeductionUnit;
  legalHourlyRateToman: number;
  legalMinuteRateToman: number;
  legalDailyAbsenceRateToman: number;
  effectiveLateRatePerUnitToman: number;
  effectiveLateMinuteRateToman: number;
  effectiveLateHourlyRateToman: number;
  effectiveAbsenceRatePerUnitToman: number;
  effectiveDailyAbsenceRateToman: number;
  effectiveHourlyAbsenceRateToman: number;
  isCustomLateRate: boolean;
  isCustomAbsenceRate: boolean;
} {
  const baseRates = calculateSalaryAndOvertimeRates(settings, 0);
  const legalHourlyRateToman = baseRates.effectiveHourlyRateToman;
  const legalMinuteRateToman =
    legalHourlyRateToman > 0 ? Math.round(legalHourlyRateToman / 60) : 0;
  const legalDailyAbsenceRateToman =
    baseRates.dailyBaseRateToman > 0
      ? baseRates.dailyBaseRateToman
      : legalHourlyRateToman * STANDARD_DAILY_WORK_HOURS;

  const lateUnit: LateDeductionUnit =
    settings.late_deduction_unit === 'HOUR' ? 'HOUR' : 'MINUTE';
  const customLateRate =
    settings.late_deduction_rate_toman != null &&
    Number(settings.late_deduction_rate_toman) > 0
      ? Math.round(Number(settings.late_deduction_rate_toman))
      : null;

  const effectiveLateRatePerUnitToman =
    customLateRate !== null
      ? customLateRate
      : lateUnit === 'HOUR'
        ? legalHourlyRateToman
        : legalMinuteRateToman;

  const effectiveLateMinuteRateToman =
    lateUnit === 'HOUR'
      ? Math.round(effectiveLateRatePerUnitToman / 60)
      : effectiveLateRatePerUnitToman;
  const effectiveLateHourlyRateToman =
    lateUnit === 'HOUR'
      ? effectiveLateRatePerUnitToman
      : effectiveLateRatePerUnitToman * 60;

  const absenceUnit: AbsenceDeductionUnit =
    settings.absence_deduction_unit === 'HOUR' ? 'HOUR' : 'DAY';
  const customAbsenceRate =
    settings.absence_deduction_rate_toman != null &&
    Number(settings.absence_deduction_rate_toman) > 0
      ? Math.round(Number(settings.absence_deduction_rate_toman))
      : null;

  const effectiveAbsenceRatePerUnitToman =
    customAbsenceRate !== null
      ? customAbsenceRate
      : absenceUnit === 'HOUR'
        ? legalHourlyRateToman
        : legalDailyAbsenceRateToman;

  const effectiveDailyAbsenceRateToman =
    absenceUnit === 'HOUR'
      ? effectiveAbsenceRatePerUnitToman * STANDARD_DAILY_WORK_HOURS
      : effectiveAbsenceRatePerUnitToman;
  const effectiveHourlyAbsenceRateToman =
    absenceUnit === 'HOUR'
      ? effectiveAbsenceRatePerUnitToman
      : Math.round(effectiveAbsenceRatePerUnitToman / STANDARD_DAILY_WORK_HOURS);

  return {
    lateUnit,
    absenceUnit,
    legalHourlyRateToman,
    legalMinuteRateToman,
    legalDailyAbsenceRateToman,
    effectiveLateRatePerUnitToman,
    effectiveLateMinuteRateToman,
    effectiveLateHourlyRateToman,
    effectiveAbsenceRatePerUnitToman,
    effectiveDailyAbsenceRateToman,
    effectiveHourlyAbsenceRateToman,
    isCustomLateRate: customLateRate !== null,
    isCustomAbsenceRate: customAbsenceRate !== null,
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
        base_salary_toman:
          snap.settings.base_salary_toman ?? currentSettings.base_salary_toman,
        hourly_rate_toman:
          snap.settings.hourly_rate_toman ?? currentSettings.hourly_rate_toman,
        banner_bg_url: currentSettings.banner_bg_url,
      };
    }
  }

  // اگر تاریخ هدف قبل از تمام اسنپ‌شات‌ها باشد، قدیمی‌ترین اسنپ‌شات ثبت‌شده ملاک دوره گذشته است
  const oldestSnap = sortedSnaps[sortedSnaps.length - 1];
  return {
    ...currentSettings,
    ...oldestSnap.settings,
    base_salary_toman:
      oldestSnap.settings.base_salary_toman ?? currentSettings.base_salary_toman,
    hourly_rate_toman:
      oldestSnap.settings.hourly_rate_toman ?? currentSettings.hourly_rate_toman,
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

// ============================================================================
// صورتحساب دقیق ماهانه (۱۵ام هر ماه تا ۱۵ام ماه بعد، بر پایه ماه کاری ۲۶ روزه)
// ============================================================================

export type StatementCycleMode = 'CONTRACT_CYCLE' | 'CALENDAR_MONTH' | 'CUSTOM_RANGE';

export interface StatementDayDetail {
  shamsiDate: string;
  dayName: string;
  regularWorkMinutes: number;
  overtimeMinutes: number;
  totalWorkMinutes: number;
  regularPayToman: number;
  overtimePayToman: number;
  lateDeductionToman?: number;
  totalDayPayToman: number;
  firstInTime: string | null;
  lastOutTime: string | null;
  statusLabel: string;
  isHistorical: boolean;
  workDaysCount: number;
}

export interface PeriodStatementSummary {
  periodKey: string;
  title: string;
  subtitle: string;
  fromShamsi: string;
  toShamsi: string;
  workDaysCount: number;
  standardMonthlyWorkDays: number;
  regularWorkMinutes: number;
  overtimeMinutes: number;
  totalNetWorkMinutes: number;
  baseSalaryReferenceToman: number;
  effectiveHourlyRateToman: number;
  effectiveOvertimeHourlyRateToman: number;
  earnedRegularSalaryToman: number;
  earnedOvertimePayToman: number;
  lateAndAbsenceDeductionToman: number;
  approvedLateMinutes: number;
  absenceDaysCount: number;
  salaryPlusOvertimeToman: number;
  approvedPettyCashToman: number;
  totalPeriodEntitlementToman: number;
  approvedTotalPaidOrReceivedToman: number;
  salaryPaidToman: number;
  advanceAndOnAccountPaidToman: number;
  otherPaidForWorkerToman: number;
  pendingAmountToman: number;
  pendingCount: number;
  periodBalanceToman: number;
  salaryAndOvertimeBalanceToman: number;
  dayDetails: StatementDayDetail[];
  periodTransactions: FinancialTransaction[];
}

/**
 * محاسبه دقیق صورتحساب یک ماه کاری (مثلاً از ۱۵ شهریور تا ۱۵ مهر)
 * - در صورتی که حقوق پایه ماهانه (base_salary_toman) تنظیم شده باشد و قرارداد ساعتی دستی نباشد،
 *   حقوق کارکرد ماه به صورت ماهانه (مبلغ کامل حقوق پایه ماهانه به ازای هر ماه کاری فعال ۱۵ام به ۱۵ام) محاسبه می‌شود
 *   و نه روزبه‌روز، و اضافه‌کاری کل ماه به آن اضافه می‌گردد.
 */
export function calculatePeriodStatement(params: {
  periodKey: string;
  title: string;
  subtitle?: string;
  fromShamsi: string;
  toShamsi: string;
  txFromShamsi?: string;
  txToShamsi?: string;
  dailySummaries: DailyAttendanceSummary[];
  historicalRecords?: HistoricalWorkRecord[];
  transactions: FinancialTransaction[];
  settings: SystemSettings;
  snapshots?: { effective_from_shamsi: string; settings: SystemSettings }[];
}): PeriodStatementSummary {
  const {
    periodKey,
    title,
    subtitle,
    fromShamsi,
    toShamsi,
    txFromShamsi,
    txToShamsi,
    dailySummaries = [],
    historicalRecords = [],
    transactions = [],
    settings,
    snapshots = [],
  } = params;

  const normFrom = isValidShamsiDate(fromShamsi) ? normalizeShamsiDate(fromShamsi) : fromShamsi;
  const normTo = isValidShamsiDate(toShamsi) ? normalizeShamsiDate(toShamsi) : toShamsi;
  const normTxFrom = txFromShamsi && isValidShamsiDate(txFromShamsi) ? normalizeShamsiDate(txFromShamsi) : normFrom;
  const normTxTo = txToShamsi && isValidShamsiDate(txToShamsi) ? normalizeShamsiDate(txToShamsi) : normTo;

  const refSettings = resolveEffectiveSettingsForShamsiDate(normTo || normFrom, settings, snapshots);
  const refRates = calculateSalaryAndOvertimeRates(refSettings, 0);

  let workDaysCount = 0;
  let regularWorkMinutes = 0;
  let overtimeMinutes = 0;
  let totalNetWorkMinutes = 0;
  let hourlyAccumRegularSalaryToman = 0;
  let earnedOvertimePayToman = 0;
  let lateAndAbsenceDeductionToman = 0;
  let approvedLateMinutes = 0;
  let absenceDaysCount = 0;

  const dayDetails: StatementDayDetail[] = [];
  const coveredDates = new Set<string>();
  const activeMonthlyCycles = new Set<string>();

  for (const day of dailySummaries) {
    if (!day.shamsi_date) continue;
    const normDate = isValidShamsiDate(day.shamsi_date)
      ? normalizeShamsiDate(day.shamsi_date)
      : day.shamsi_date;

    if (normDate < normFrom || normDate > normTo) {
      continue;
    }

    const dayLateDeduction = Math.max(0, Math.round(Number(day.late_deduction_toman || 0)));
    const isManagerAbsenceDay = day.late_status === 'ABSENCE';

    if (day.is_incomplete && !isManagerAbsenceDay && dayLateDeduction === 0) {
      continue;
    }

    const isLiveLogDay = Array.isArray(day.logs) && day.logs.length > 0;
    const hasHistoricalWork =
      !isLiveLogDay && (day.net_work_minutes > 0 || day.overtime_minutes > 0);

    if (!isLiveLogDay && !hasHistoricalWork && dayLateDeduction === 0) {
      continue;
    }

    coveredDates.add(normDate);
    activeMonthlyCycles.add(getMonthlyCycleKeyForShamsiDate(normDate, 15));

    const effDaySettings = resolveEffectiveSettingsForShamsiDate(normDate, settings, snapshots);
    const dayOtMins = Math.max(0, Number(day.overtime_minutes) || 0);
    const dayRegMins = isLiveLogDay
      ? Math.max(0, Number(day.net_work_minutes || 0) - dayOtMins)
      : Math.max(0, Number(day.net_work_minutes || 0));
    const dayTotalMins = isLiveLogDay
      ? Math.max(0, Number(day.net_work_minutes || 0))
      : dayRegMins + dayOtMins;

    const dayRates = calculateSalaryAndOvertimeRates(effDaySettings, dayOtMins);
    const dayRegPay = Math.round((dayRegMins / 60) * dayRates.effectiveHourlyRateToman);
    const dayOtPay = dayRates.totalOvertimePayToman;

    if (!isManagerAbsenceDay) {
      workDaysCount += 1;
    } else {
      absenceDaysCount += 1;
    }
    regularWorkMinutes += dayRegMins;
    overtimeMinutes += dayOtMins;
    totalNetWorkMinutes += dayTotalMins;
    hourlyAccumRegularSalaryToman += dayRegPay;
    earnedOvertimePayToman += dayOtPay;
    lateAndAbsenceDeductionToman += dayLateDeduction;
    if (
      day.late_status === 'APPROVED_DELAY' ||
      day.late_status === 'CUSTOM'
    ) {
      approvedLateMinutes += Math.max(0, Number(day.late_minutes || 0));
    }

    dayDetails.push({
      shamsiDate: normDate,
      dayName: day.day_name || '',
      regularWorkMinutes: dayRegMins,
      overtimeMinutes: dayOtMins,
      totalWorkMinutes: dayTotalMins,
      regularPayToman: dayRegPay,
      overtimePayToman: dayOtPay,
      lateDeductionToman: dayLateDeduction,
      totalDayPayToman: Math.max(0, dayRegPay + dayOtPay - dayLateDeduction),
      firstInTime: day.first_in_time,
      lastOutTime: day.last_out_time,
      statusLabel: day.status_label || 'ثبت قطعی',
      isHistorical: !isLiveLogDay,
      workDaysCount: isManagerAbsenceDay ? 0 : 1,
    });
  }

  for (const rec of historicalRecords) {
    if (rec.status !== 'APPROVED') continue;
    if (rec.parsed_rows && rec.parsed_rows.length > 0) {
      for (const row of rec.parsed_rows) {
        if (!row.shamsi_date || !isValidShamsiDate(row.shamsi_date)) continue;
        const normRowDate = normalizeShamsiDate(row.shamsi_date);
        if (normRowDate < normFrom || normRowDate > normTo) continue;
        if (coveredDates.has(normRowDate)) continue;
        coveredDates.add(normRowDate);
        activeMonthlyCycles.add(getMonthlyCycleKeyForShamsiDate(normRowDate, 15));

        const rowRegMins = Math.max(0, Number(row.net_work_minutes || 0));
        const rowOtMins = Math.max(0, Number(row.overtime_minutes || 0));
        const effRowSettings = resolveEffectiveSettingsForShamsiDate(
          normRowDate,
          settings,
          snapshots
        );
        const rowRates = calculateSalaryAndOvertimeRates(effRowSettings, rowOtMins);
        const rowRegPay = Math.round((rowRegMins / 60) * rowRates.effectiveHourlyRateToman);
        const rowOtPay = rowRates.totalOvertimePayToman;

        workDaysCount += Number(row.work_days_count || 1);
        regularWorkMinutes += rowRegMins;
        overtimeMinutes += rowOtMins;
        totalNetWorkMinutes += rowRegMins;
        hourlyAccumRegularSalaryToman += rowRegPay;
        earnedOvertimePayToman += rowOtPay;

        dayDetails.push({
          shamsiDate: normRowDate,
          dayName: '',
          regularWorkMinutes: rowRegMins,
          overtimeMinutes: rowOtMins,
          totalWorkMinutes: rowRegMins + rowOtMins,
          regularPayToman: rowRegPay,
          overtimePayToman: rowOtPay,
          totalDayPayToman: rowRegPay + rowOtPay,
          firstInTime: row.check_in || null,
          lastOutTime: row.check_out || null,
          statusLabel: row.note || row.title || rec.title || 'سابقه کارکرد',
          isHistorical: true,
          workDaysCount: Number(row.work_days_count || 1),
        });
      }
    } else {
      const normRecDate = isValidShamsiDate(rec.shamsi_date)
        ? normalizeShamsiDate(rec.shamsi_date)
        : rec.shamsi_date;
      if (!normRecDate || normRecDate < normFrom || normRecDate > normTo) continue;
      if (rec.work_days_count === 1 && coveredDates.has(normRecDate)) continue;
      if (rec.work_days_count === 1) coveredDates.add(normRecDate);
      activeMonthlyCycles.add(getMonthlyCycleKeyForShamsiDate(normRecDate, 15));

      const recRegMins = Math.max(0, Number(rec.net_work_minutes || 0));
      const recOtMins = Math.max(0, Number(rec.overtime_minutes || 0));
      const effRecSettings = resolveEffectiveSettingsForShamsiDate(
        normRecDate,
        settings,
        snapshots
      );
      const recRates = calculateSalaryAndOvertimeRates(effRecSettings, recOtMins);
      const recRegPay = Math.round((recRegMins / 60) * recRates.effectiveHourlyRateToman);
      const recOtPay = recRates.totalOvertimePayToman;

      workDaysCount += Number(rec.work_days_count || 1);
      regularWorkMinutes += recRegMins;
      overtimeMinutes += recOtMins;
      totalNetWorkMinutes += recRegMins;
      hourlyAccumRegularSalaryToman += recRegPay;
      earnedOvertimePayToman += recOtPay;

      dayDetails.push({
        shamsiDate: normRecDate,
        dayName: '',
        regularWorkMinutes: recRegMins,
        overtimeMinutes: recOtMins,
        totalWorkMinutes: recRegMins + recOtMins,
        regularPayToman: recRegPay,
        overtimePayToman: recOtPay,
        totalDayPayToman: recRegPay + recOtPay,
        firstInTime: null,
        lastOutTime: null,
        statusLabel: rec.title || rec.note || 'سابقه کارکرد تجمیعی',
        isHistorical: true,
        workDaysCount: Number(rec.work_days_count || 1),
      });
    }
  }

  dayDetails.sort((a, b) => b.shamsiDate.localeCompare(a.shamsiDate));

  // اگر حقوق پایه ماهانه تنظیم شده باشد و نرخ ساعتی دستی جداگانه وارد نشده باشد،
  // محاسبه حقوق به صورت ماهانه (مبلغ کامل حقوق پایه ماهانه برای هر دوره ماهانه فعال) انجام می‌شود.
  const isMonthlyFixedSalaryMode =
    refRates.baseSalaryToman > 0 &&
    (!refSettings.hourly_rate_toman || refSettings.hourly_rate_toman <= 0);

  let earnedRegularSalaryToman = 0;
  if (workDaysCount > 0) {
    if (isMonthlyFixedSalaryMode) {
      const cyclesCount = Math.max(1, activeMonthlyCycles.size);
      earnedRegularSalaryToman = refRates.baseSalaryToman * cyclesCount;
    } else {
      earnedRegularSalaryToman = hourlyAccumRegularSalaryToman;
    }
  }

  // فیلتر تراکنش‌های مالی در این بازه زمانی
  const periodTransactions = transactions
    .filter((tx) => {
      if (!tx.shamsi_date) return false;
      const normTxDate = isValidShamsiDate(tx.shamsi_date)
        ? normalizeShamsiDate(tx.shamsi_date)
        : tx.shamsi_date;
      return normTxDate >= normTxFrom && normTxDate <= normTxTo;
    })
    .sort((a, b) => b.shamsi_date.localeCompare(a.shamsi_date) || b.id - a.id);

  let approvedPettyCashToman = 0;
  let approvedTotalPaidOrReceivedToman = 0;
  let salaryPaidToman = 0;
  let advanceAndOnAccountPaidToman = 0;
  let otherPaidForWorkerToman = 0;
  let pendingAmountToman = 0;
  let pendingCount = 0;

  for (const tx of periodTransactions) {
    const amt = Math.max(0, Math.round(Number(tx.amount_toman) || 0));
    if (tx.status === 'PENDING') {
      pendingAmountToman += amt;
      pendingCount += 1;
      continue;
    }
    if (tx.status !== 'APPROVED') {
      continue;
    }

    if (tx.tx_type === 'PETTY_CASH') {
      approvedPettyCashToman += amt;
    } else {
      approvedTotalPaidOrReceivedToman += amt;
      if (tx.tx_type === 'SALARY') {
        salaryPaidToman += amt;
      } else if (tx.tx_type === 'ADVANCE' || tx.tx_type === 'ON_ACCOUNT') {
        advanceAndOnAccountPaidToman += amt;
      } else {
        otherPaidForWorkerToman += amt;
      }
    }
  }

  const salaryPlusOvertimeToman = Math.max(
    0,
    earnedRegularSalaryToman + earnedOvertimePayToman - lateAndAbsenceDeductionToman
  );
  const totalPeriodEntitlementToman = salaryPlusOvertimeToman + approvedPettyCashToman;
  const periodBalanceToman = totalPeriodEntitlementToman - approvedTotalPaidOrReceivedToman;
  const salaryAndOvertimeBalanceToman =
    salaryPlusOvertimeToman - approvedTotalPaidOrReceivedToman;

  const formattedSubtitle =
    subtitle ||
    `از ${toPersianDigits(normFrom)} تا ${toPersianDigits(normTo)}`;

  return {
    periodKey,
    title,
    subtitle: formattedSubtitle,
    fromShamsi: normFrom,
    toShamsi: normTo,
    workDaysCount,
    standardMonthlyWorkDays: STANDARD_MONTHLY_WORK_DAYS,
    regularWorkMinutes,
    overtimeMinutes,
    totalNetWorkMinutes,
    baseSalaryReferenceToman: refRates.baseSalaryToman,
    effectiveHourlyRateToman: refRates.effectiveHourlyRateToman,
    effectiveOvertimeHourlyRateToman: refRates.effectiveOvertimeHourlyRateToman,
    earnedRegularSalaryToman,
    earnedOvertimePayToman,
    lateAndAbsenceDeductionToman,
    approvedLateMinutes,
    absenceDaysCount,
    salaryPlusOvertimeToman,
    approvedPettyCashToman,
    totalPeriodEntitlementToman,
    approvedTotalPaidOrReceivedToman,
    salaryPaidToman,
    advanceAndOnAccountPaidToman,
    otherPaidForWorkerToman,
    pendingAmountToman,
    pendingCount,
    periodBalanceToman,
    salaryAndOvertimeBalanceToman,
    dayDetails,
    periodTransactions,
  };
}

/**
 * تولید لیست دوره‌های ماهانه (۱۵ام به ۱۵ام هر ماه، مثلاً ۱۵ شهریور تا ۱۵ مهر)
 * بدون هم‌پوشانی روزها یا پرداختی‌ها بین دو ماه متوالی
 */
export function generateStatementPeriods(params: {
  mode?: 'CONTRACT_CYCLE' | 'CALENDAR_MONTH';
  cycleStartDay?: number;
  inclusiveEndDay?: boolean;
  currentShamsiDate: string;
  collaborationStartShamsi?: string | null;
  dailySummaries: DailyAttendanceSummary[];
  historicalRecords?: HistoricalWorkRecord[];
  transactions: FinancialTransaction[];
  settings: SystemSettings;
  snapshots?: { effective_from_shamsi: string; settings: SystemSettings }[];
}): PeriodStatementSummary[] {
  const {
    mode = 'CONTRACT_CYCLE',
    cycleStartDay = 15,
    currentShamsiDate,
    collaborationStartShamsi,
    dailySummaries = [],
    historicalRecords = [],
    transactions = [],
    settings,
    snapshots = [],
  } = params;

  const safeAnchorDay = Math.min(29, Math.max(1, Math.round(Number(cycleStartDay) || 15)));
  const rawCollabStart =
    collaborationStartShamsi || settings.collaboration_start_shamsi || '1405/06/15';
  const normCollabStart = isValidShamsiDate(rawCollabStart)
    ? normalizeShamsiDate(rawCollabStart)
    : '1405/06/15';

  // جمع‌آوری تمام سال/ماه‌های شمسی موجود در داده‌ها + ماه جاری و ماه شروع همکاری
  const yearMonthSet = new Set<string>();

  const addYearMonthFromDate = (rawDate: string | null | undefined) => {
    if (!rawDate || !isValidShamsiDate(rawDate)) return;
    const norm = normalizeShamsiDate(rawDate);
    const [jy, jm, jd] = norm.split('/').map(Number);
    if (jy && jm) {
      yearMonthSet.add(`${jy}/${pad2(jm)}`);
      if (jd < safeAnchorDay) {
        const prevJm = jm === 1 ? 12 : jm - 1;
        const prevJy = jm === 1 ? jy - 1 : jy;
        yearMonthSet.add(`${prevJy}/${pad2(prevJm)}`);
      }
    }
  };

  addYearMonthFromDate(currentShamsiDate);
  addYearMonthFromDate(normCollabStart);

  for (const d of dailySummaries) {
    addYearMonthFromDate(d.shamsi_date);
  }
  for (const h of historicalRecords) {
    addYearMonthFromDate(h.shamsi_date);
    if (h.parsed_rows) {
      for (const r of h.parsed_rows) {
        addYearMonthFromDate(r.shamsi_date);
      }
    }
  }
  for (const t of transactions) {
    addYearMonthFromDate(t.shamsi_date);
  }

  const sortedYearMonths = Array.from(yearMonthSet)
    .map((ym) => {
      const [jy, jm] = ym.split('/').map(Number);
      return { key: ym, jy, jm };
    })
    .filter((item) => item.jy >= 1390 && item.jy <= 1450 && item.jm >= 1 && item.jm <= 12)
    .sort((a, b) => (a.jy !== b.jy ? b.jy - a.jy : b.jm - a.jm));

  const results: PeriodStatementSummary[] = [];

  for (const { jy, jm } of sortedYearMonths) {
    if (mode === 'CALENDAR_MONTH') {
      const mLen = getShamsiMonthDays(jy, jm);
      const fromShamsi = `${jy}/${pad2(jm)}/01`;
      const toShamsi = `${jy}/${pad2(jm)}/${pad2(mLen)}`;
      const mName = PERSIAN_MONTHS[jm - 1] || '';
      const title = `${mName} ${toPersianDigits(jy)}`;
      const subtitle = `۱ ${mName} تا ${toPersianDigits(mLen)} ${mName} ${toPersianDigits(jy)}`;

      const stmt = calculatePeriodStatement({
        periodKey: `cal-${jy}-${pad2(jm)}`,
        title,
        subtitle,
        fromShamsi,
        toShamsi,
        dailySummaries,
        historicalRecords,
        transactions,
        settings,
        snapshots,
      });
      results.push(stmt);
    } else {
      // CONTRACT_CYCLE: دوره ماهانه ۱۵ام به ۱۵ام (مثلاً ۱۵ شهریور تا ۱۵ مهر)
      const startMonthLen = getShamsiMonthDays(jy, jm);
      const startDay = Math.min(safeAnchorDay, startMonthLen);
      const fromShamsi = `${jy}/${pad2(jm)}/${pad2(startDay)}`;

      const nextJm = jm === 12 ? 1 : jm + 1;
      const nextJy = jm === 12 ? jy + 1 : jy;
      const nextMonthLen = getShamsiMonthDays(nextJy, nextJm);

      // روزهای کاری هر ماه از ۱۵ام ماه اول تا ۱۴ام ماه بعد است تا روز ۱۵ام در دو ماه متوالی دوبار شمارش نشود
      const workEndDay = Math.min(Math.max(1, safeAnchorDay - 1), nextMonthLen);
      const workToShamsi = `${nextJy}/${pad2(nextJm)}/${pad2(workEndDay)}`;

      // پرداختی‌ها و تسویه حقوق در روز ۱۵ام ماه بعد (مثلاً پرداخت حقوق در ۱۵ مهر) متعلق به تسویه همان ماهِ پایان‌یافته (۱۵ شهریور تا ۱۵ مهر) است
      const txStartDay =
        fromShamsi <= normCollabStart ? startDay : Math.min(startMonthLen, startDay + 1);
      const txFromShamsi = `${jy}/${pad2(jm)}/${pad2(txStartDay)}`;
      const txEndDay = Math.min(safeAnchorDay, nextMonthLen);
      const displayEndShamsi = `${nextJy}/${pad2(nextJm)}/${pad2(txEndDay)}`;

      const startMonthName = PERSIAN_MONTHS[jm - 1] || '';
      const title = `${startMonthName} ${toPersianDigits(jy)}`;
      const subtitle = `${startMonthName} ${toPersianDigits(jy)}`;

      const stmt = calculatePeriodStatement({
        periodKey: `cycle-${fromShamsi}-${displayEndShamsi}`,
        title,
        subtitle,
        fromShamsi,
        toShamsi: workToShamsi,
        txFromShamsi,
        txToShamsi: displayEndShamsi,
        dailySummaries,
        historicalRecords,
        transactions,
        settings,
        snapshots,
      });
      // نمایش بازه ۱۵ام به ۱۵ام برای خوانایی کاربر
      stmt.toShamsi = displayEndShamsi;
      results.push(stmt);
    }
  }

  const normNow = isValidShamsiDate(currentShamsiDate)
    ? normalizeShamsiDate(currentShamsiDate)
    : '1405/08/01';

  const filtered = results.filter((stmt, idx) => {
    const isCurrentPeriod = normNow >= stmt.fromShamsi && normNow <= stmt.toShamsi;
    const hasData =
      stmt.workDaysCount > 0 ||
      stmt.totalNetWorkMinutes > 0 ||
      stmt.overtimeMinutes > 0 ||
      stmt.periodTransactions.length > 0;
    return isCurrentPeriod || hasData || idx === 0;
  });

  return filtered.length > 0 ? filtered : results.slice(0, 3);
}



