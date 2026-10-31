import React, { useEffect, useRef, useState } from 'react';
import { UserRole, WorkTaskItem } from '../shared/types';
import { apiRequest } from '../services/api';
import { ShamsiDatePicker } from './ShamsiDatePicker';
import { toPersianDigits } from '../shared/jalali';
import {
  CheckSquare,
  Square,
  Plus,
  Trash2,
  FilePlus2,
  CheckCheck,
  Clock,
  RotateCcw,
  CalendarClock,
} from 'lucide-react';

interface DailyTasksChecklistProps {
  role: UserRole;
  currentShamsiDate: string;
  sectionMode?: 'full' | 'pending_only' | 'archived_only';
  hideCreateForm?: boolean;
  refreshTrigger?: number;
  externalTasks?: WorkTaskItem[];
  onTasksUpdated?: () => void;
  onAddCompletedToReport?: (summaryText: string) => void;
}

export const DailyTasksChecklist: React.FC<DailyTasksChecklistProps> = ({
  role,
  currentShamsiDate,
  sectionMode = 'full',
  hideCreateForm = false,
  refreshTrigger = 0,
  externalTasks,
  onTasksUpdated,
  onAddCompletedToReport,
}) => {
  const [internalTasks, setInternalTasks] = useState<WorkTaskItem[]>([]);
  const [loading, setLoading] = useState(externalTasks === undefined);
  const [showAddForm, setShowAddForm] = useState(role === 'manager');

  const [newTitle, setNewTitle] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newDate, setNewDate] = useState(currentShamsiDate);
  const [submitting, setSubmitting] = useState(false);
  const [taskFeedback, setTaskFeedback] = useState<string | null>(null);
  const createFormRef = useRef<HTMLFormElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (currentShamsiDate && !newDate) {
      setNewDate(currentShamsiDate);
    }
  }, [currentShamsiDate, newDate]);

  const fetchTasks = async () => {
    try {
      const res = await apiRequest<{ ok: boolean; tasks: WorkTaskItem[] }>('/api/tasks');
      setInternalTasks(res.tasks);
      if (onTasksUpdated) onTasksUpdated();
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (externalTasks === undefined) {
      fetchTasks();
    } else {
      setLoading(false);
    }
  }, [externalTasks, refreshTrigger]);

  const tasks = externalTasks !== undefined ? externalTasks : internalTasks;
  const pendingTasks = tasks.filter((t) => !t.is_completed);
  const completedTasks = tasks.filter((t) => t.is_completed);

  const resetCreateForm = () => {
    setNewTitle('');
    setNewDesc('');
    setNewDate(currentShamsiDate);
    createFormRef.current?.reset();
    window.setTimeout(() => {
      titleInputRef.current?.focus();
    }, 30);
  };

  const handleCreateTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) return;
    setSubmitting(true);
    setTaskFeedback(null);
    const targetDate = newDate || currentShamsiDate;
    try {
      await apiRequest('/api/tasks', {
        method: 'POST',
        body: JSON.stringify({
          title: newTitle.trim(),
          description: newDesc.trim() || null,
          shamsi_date: targetDate,
        }),
      });
      resetCreateForm();
      setTaskFeedback(
        `برنامه کاری جدید برای تاریخ ${toPersianDigits(targetDate)} ثبت شد و فرم برای ورودی بعدی پاکسازی گردید.`
      );
      await fetchTasks();
    } catch {
      // ignore
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggle = async (task: WorkTaskItem, alsoAddToReport = false) => {
    try {
      const nextCompleted = !task.is_completed;
      await apiRequest(`/api/tasks/${task.id}/toggle`, {
        method: 'PATCH',
        body: JSON.stringify({ is_completed: nextCompleted }),
      });
      if (alsoAddToReport && nextCompleted && onAddCompletedToReport) {
        const line = `• انجام شد: ${task.title}${task.description ? ` (${task.description})` : ''}`;
        onAddCompletedToReport(line);
      }
      await fetchTasks();
    } catch {
      // ignore
    }
  };

  const handleDelete = async (taskId: number) => {
    try {
      await apiRequest(`/api/tasks/${taskId}`, { method: 'DELETE' });
      await fetchTasks();
    } catch {
      // ignore
    }
  };

  const handlePushAllCompletedToReport = () => {
    if (!onAddCompletedToReport || completedTasks.length === 0) return;
    const lines = completedTasks.map(
      (t) => `• انجام شد: ${t.title}${t.description ? ` (${t.description})` : ''}`
    );
    onAddCompletedToReport(lines.join('\n'));
  };

  // بخش ۱ (بالای صفحه): برنامه‌های کاری در انتظار انجام و تعیین تکلیف
  const renderPendingSection = () => (
    <div className="rounded-2xl bg-gradient-to-b from-[#FCF9F2] to-white border-2 border-[#C5A059] p-4 space-y-3 shadow-xs">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#C5A059]/30 pb-2.5">
        <div className="flex items-center gap-2">
          <span
            className={`w-2.5 h-2.5 rounded-full shrink-0 ${
              pendingTasks.length > 0 ? 'bg-[#C5A059] animate-ping' : 'bg-emerald-500'
            }`}
          />
          <div>
            <h3 className="text-xs sm:text-sm font-extrabold text-[#0B192C]">
              {pendingTasks.length > 0
                ? `برنامه‌های کاری ارسالی مدیریت (${toPersianDigits(pendingTasks.length)} مورد در انتظار انجام)`
                : 'برنامه‌های کاری ارسالی مدیریت'}
            </h3>
            <p className="text-[10.5px] text-slate-500 mt-0.5">
              {role === 'worker'
                ? 'پس از انجام هر برنامه کاری، آن را تیک بزنید تا به آرشیو انجام‌شده‌ها منتقل شود.'
                : 'فهرست برنامه‌های کاری جاری و زمان‌بندی‌شده برای تاریخ‌های آینده که هنوز انجام نشده‌اند.'}
            </p>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="text-xs text-slate-400 text-center py-2">
          در حال بارگذاری برنامه‌های کاری...
        </div>
      ) : pendingTasks.length === 0 ? (
        <div className="rounded-xl bg-emerald-50/70 border border-emerald-200/80 px-3 py-2.5 flex items-center gap-2 text-xs text-emerald-900">
          <CheckCheck className="w-4 h-4 text-emerald-600 shrink-0" />
          <span>
            در حال حاضر برنامه کاری باز وجود ندارد؛ موارد انجام‌شده در بخش آرشیو قرار دارند.
          </span>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          {pendingTasks.map((task) => {
            const isFutureDue =
              Boolean(currentShamsiDate) && task.shamsi_date > currentShamsiDate;
            return (
              <div
                key={task.id}
                className="rounded-2xl bg-white border-2 border-[#C5A059] p-3.5 space-y-2.5 shadow-2xs flex flex-col justify-between"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-start gap-2.5">
                    <Square className="w-4 h-4 text-[#C5A059] shrink-0 mt-0.5" />
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="px-2 py-0.5 rounded-md bg-[#0B192C] text-[#C5A059] text-[10px] font-extrabold">
                          برنامه کاری
                        </span>
                        {isFutureDue && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-indigo-50 text-indigo-800 border border-indigo-200 text-[10px] font-bold tabular-nums">
                            <CalendarClock className="w-3 h-3" />
                            <span>موعد تحویل: {toPersianDigits(task.shamsi_date)}</span>
                          </span>
                        )}
                        <span className="text-xs font-extrabold text-[#0B192C]">{task.title}</span>
                      </div>
                      {task.description && (
                        <div className="text-xs text-slate-700 leading-5 pt-0.5 whitespace-pre-line">
                          {task.description}
                        </div>
                      )}
                      <div className="text-[10.5px] text-slate-500 tabular-nums flex items-center gap-1.5">
                        <span>
                          تاریخ تحویل / انجام:{' '}
                          <strong className="text-[#0B192C]">
                            {toPersianDigits(task.shamsi_date)}
                          </strong>
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <span className="inline-flex items-center gap-1 text-[10.5px] text-amber-800 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-lg font-bold">
                      <Clock className="w-3 h-3" />
                      <span>در انتظار انجام</span>
                    </span>
                    {role === 'manager' && (
                      <button
                        type="button"
                        onClick={() => handleDelete(task.id)}
                        title="حذف برنامه کاری"
                        className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>

                {/* نوار تعیین تکلیف برنامه کاری */}
                <div className="pt-2 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[11px] font-semibold text-slate-600">
                    وضعیت اجرای برنامه کاری:
                  </span>
                  <div className="flex flex-wrap items-center gap-2">
                    {role === 'worker' && onAddCompletedToReport && (
                      <button
                        type="button"
                        onClick={() => handleToggle(task, true)}
                        className="min-h-[32px] px-2.5 rounded-xl bg-[#FCF9F2] hover:bg-[#C5A059]/20 border border-[#C5A059] text-[11px] font-bold text-[#0B192C] flex items-center gap-1 cursor-pointer"
                      >
                        <FilePlus2 className="w-3.5 h-3.5 text-[#9A7428]" />
                        <span>انجام شد + درج در فرم گزارش</span>
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => handleToggle(task, false)}
                      className="min-h-[32px] px-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-bold flex items-center gap-1.5 shadow-2xs cursor-pointer"
                    >
                      <CheckCheck className="w-3.5 h-3.5" />
                      <span>انجام شد (انتقال به آرشیو)</span>
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );

  // بخش ۲ (ویژه مدیر در حالت مستقل): فرم ثبت برنامه کاری جدید با امکان انتخاب تاریخ‌های دورتر و پاکسازی کامل پس از ثبت
  const renderManagerCreateSection = () =>
    role === 'manager' && !hideCreateForm ? (
      <div className="rounded-2xl bg-white border border-[#C5A059]/50 p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Plus className="w-4 h-4 text-[#C5A059]" />
            <h3 className="text-xs sm:text-sm font-bold text-[#0B192C]">
              ثبت برنامه کاری جدید برای پرسنل (امید میثمی)
            </h3>
          </div>
          <button
            type="button"
            onClick={() => setShowAddForm((s) => !s)}
            className="min-h-[32px] px-3 rounded-xl bg-[#FCF9F2] text-[#0B192C] border border-[#C5A059] text-xs font-bold hover:bg-[#C5A059]/20 cursor-pointer"
          >
            {showAddForm ? 'بستن فرم' : 'نمایش فرم ثبت برنامه کاری'}
          </button>
        </div>

        {showAddForm && (
          <form
            ref={createFormRef}
            onSubmit={handleCreateTask}
            className="rounded-2xl bg-[#FCF9F2] border border-[#C5A059]/60 p-3.5 space-y-3"
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  عنوان برنامه کاری (تایپ مستقیم توسط مدیر)
                </label>
                <input
                  ref={titleInputRef}
                  type="text"
                  required
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="عنوان برنامه کاری را تایپ کنید (مثلاً: تحویل سفارش X)..."
                  className="w-full min-h-[42px] rounded-xl border border-slate-200 bg-white px-3 text-xs focus:outline-none focus:border-[#0B192C]"
                />
              </div>
              <ShamsiDatePicker
                label="تاریخ تحویل / انجام برنامه کاری (امروز یا روزهای آینده)"
                value={newDate}
                onChange={setNewDate}
                todayShamsi={currentShamsiDate}
              />
            </div>

            {newDate > currentShamsiDate && (
              <div className="rounded-xl bg-indigo-50/80 border border-indigo-200 px-3 py-2 flex items-center gap-2 text-xs text-indigo-950">
                <CalendarClock className="w-4 h-4 text-indigo-700 shrink-0" />
                <span>
                  این برنامه کاری برای تاریخ آینده{' '}
                  <strong className="tabular-nums">{toPersianDigits(newDate)}</strong> زمان‌بندی و ثبت می‌شود.
                </span>
              </div>
            )}

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                شرح و جزئیات برنامه کاری (اختیاری)
              </label>
              <textarea
                rows={2}
                value={newDesc}
                onChange={(e) => setNewDesc(e.target.value)}
                placeholder="شرح کامل برنامه کاری، جزئیات تحویل و نکات لازم را تایپ کنید..."
                className="w-full rounded-xl border border-slate-200 bg-white p-3 text-xs leading-6 focus:outline-none focus:border-[#0B192C]"
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="submit"
                disabled={submitting}
                className="flex-1 min-h-[42px] rounded-xl bg-[#0B192C] text-[#C5A059] border border-[#C5A059] text-xs font-bold hover:bg-[#142844] cursor-pointer"
              >
                {submitting ? 'در حال ثبت...' : 'ثبت و ارسال برنامه کاری جدید'}
              </button>
              {(newTitle || newDesc || newDate !== currentShamsiDate) && (
                <button
                  type="button"
                  onClick={resetCreateForm}
                  className="min-h-[42px] px-3.5 rounded-xl bg-white border border-slate-200 text-xs font-semibold text-slate-600 hover:text-slate-900 cursor-pointer"
                >
                  پاکسازی فرم
                </button>
              )}
            </div>
            {taskFeedback && (
              <div className="rounded-xl bg-emerald-50 border border-emerald-200 px-3 py-2 text-[11px] font-bold text-emerald-900 flex items-center justify-between">
                <span>{taskFeedback}</span>
                <button
                  type="button"
                  onClick={() => setTaskFeedback(null)}
                  className="text-[10px] underline cursor-pointer"
                >
                  بستن
                </button>
              </div>
            )}
          </form>
        )}
      </div>
    ) : null;

  // بخش ۳ (پایین صفحه): آرشیو برنامه‌های کاری انجام‌شده
  const renderArchivedSection = () => (
    <div className="rounded-2xl bg-white border border-slate-200 p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2">
        <div className="flex items-center gap-2">
          <CheckSquare className="w-4 h-4 text-emerald-600" />
          <div>
            <h3 className="text-xs sm:text-sm font-bold text-[#0B192C]">
              آرشیو برنامه‌های کاری انجام‌شده ({toPersianDigits(completedTasks.length)})
            </h3>
            <p className="text-[10.5px] text-slate-500 mt-0.5">
              برنامه‌های کاری که انجام شده‌اند در این بخش آرشیو می‌شوند.
            </p>
          </div>
        </div>

        {role === 'worker' && completedTasks.length > 0 && onAddCompletedToReport && (
          <button
            type="button"
            onClick={handlePushAllCompletedToReport}
            className="min-h-[32px] px-2.5 rounded-xl bg-[#FCF9F2] border border-[#C5A059] text-[11px] font-bold text-[#0B192C] hover:bg-[#C5A059]/20 flex items-center gap-1 cursor-pointer"
          >
            <FilePlus2 className="w-3.5 h-3.5 text-[#9A7428]" />
            <span>افزودن همه انجام‌شده‌ها به متن گزارش</span>
          </button>
        )}
      </div>

      {completedTasks.length === 0 ? (
        <div className="text-xs text-slate-500 text-center py-3">
          هنوز برنامه کاری در آرشیو انجام‌شده‌ها ثبت نشده است.
        </div>
      ) : (
        <div className="space-y-1.5">
          {completedTasks.map((task) => (
            <div
              key={task.id}
              className="rounded-2xl bg-emerald-50/40 border border-emerald-200/80 p-3 flex flex-wrap items-center justify-between gap-2"
            >
              <div className="flex items-start gap-2.5">
                <CheckSquare className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                <div className="space-y-0.5">
                  <div className="text-xs font-bold line-through text-slate-600">{task.title}</div>
                  {task.description && (
                    <div className="text-[11px] text-slate-500">{task.description}</div>
                  )}
                  <div className="text-[10px] text-slate-400 tabular-nums">
                    تاریخ تحویل: {toPersianDigits(task.shamsi_date)} · وضعیت: انجام‌شده (آرشیو)
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => handleToggle(task, false)}
                  className="min-h-[28px] px-2.5 rounded-lg bg-white hover:bg-slate-100 border border-slate-200 text-[10.5px] font-semibold text-slate-600 flex items-center gap-1 cursor-pointer"
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>بازگردانی به لیست جاری</span>
                </button>
                {role === 'manager' && (
                  <button
                    type="button"
                    onClick={() => handleDelete(task.id)}
                    title="حذف برنامه کاری"
                    className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  if (sectionMode === 'pending_only') {
    return renderPendingSection();
  }

  if (sectionMode === 'archived_only') {
    return renderArchivedSection();
  }

  return (
    <div className="space-y-3.5">
      {renderPendingSection()}
      {renderManagerCreateSection()}
      {renderArchivedSection()}
    </div>
  );
};


