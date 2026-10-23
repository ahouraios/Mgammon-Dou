import React, { useEffect, useState } from 'react';
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
} from 'lucide-react';

interface DailyTasksChecklistProps {
  role: UserRole;
  currentShamsiDate: string;
  sectionMode?: 'full' | 'pending_only' | 'archived_only';
  externalTasks?: WorkTaskItem[];
  onTasksUpdated?: () => void;
  onAddCompletedToReport?: (summaryText: string) => void;
}

export const DailyTasksChecklist: React.FC<DailyTasksChecklistProps> = ({
  role,
  currentShamsiDate,
  sectionMode = 'full',
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
  }, [externalTasks]);

  const tasks = externalTasks !== undefined ? externalTasks : internalTasks;
  const pendingTasks = tasks.filter((t) => !t.is_completed);
  const completedTasks = tasks.filter((t) => t.is_completed);

  const handleCreateTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) return;
    setSubmitting(true);
    try {
      await apiRequest('/api/tasks', {
        method: 'POST',
        body: JSON.stringify({
          title: newTitle.trim(),
          description: newDesc.trim() || null,
          shamsi_date: newDate,
        }),
      });
      setNewTitle('');
      setNewDesc('');
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

  // بخش ۱ (بالای صفحه): تسک‌های جدید و در انتظار تعیین تکلیف
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
                ? `تسک‌ها و وظایف جدید ارسالی مدیریت (${toPersianDigits(pendingTasks.length)} مورد در انتظار تعیین تکلیف)`
                : 'تسک‌ها و وظایف جدید ارسالی مدیریت'}
            </h3>
            <p className="text-[10.5px] text-slate-500 mt-0.5">
              {role === 'worker'
                ? 'پس از انجام یا بررسی هر تسک، آن را تعیین تکلیف کنید تا به بخش آرشیو پایین صفحه منتقل شود.'
                : 'فهرست تسک‌های باز که هنوز توسط پرسنل انجام و آرشیو نشده‌اند.'}
            </p>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="text-xs text-slate-400 text-center py-2">در حال بارگذاری تسک‌ها...</div>
      ) : pendingTasks.length === 0 ? (
        <div className="rounded-xl bg-emerald-50/70 border border-emerald-200/80 px-3 py-2.5 flex items-center gap-2 text-xs text-emerald-900">
          <CheckCheck className="w-4 h-4 text-emerald-600 shrink-0" />
          <span>
            در حال حاضر تسک جدید بررسی‌نشده‌ای وجود ندارد؛ موارد انجام‌شده در بخش آرشیو پایین صفحه قرار دارند.
          </span>
        </div>
      ) : (
        <div className="space-y-2.5">
          {pendingTasks.map((task) => (
            <div
              key={task.id}
              className="rounded-2xl bg-white border-2 border-[#C5A059] p-3.5 space-y-2.5 shadow-2xs"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-start gap-2.5">
                  <Square className="w-4 h-4 text-[#C5A059] shrink-0 mt-0.5" />
                  <div className="space-y-0.5">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="px-2 py-0.5 rounded-md bg-[#0B192C] text-[#C5A059] text-[10px] font-extrabold">
                        تسک جدید
                      </span>
                      <span className="text-xs font-extrabold text-[#0B192C]">{task.title}</span>
                    </div>
                    {task.description && (
                      <div className="text-xs text-slate-700 leading-5 pt-0.5">
                        {task.description}
                      </div>
                    )}
                    <div className="text-[10.5px] text-slate-500 tabular-nums">
                      تاریخ انجام: {toPersianDigits(task.shamsi_date)}
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
                      title="حذف تسک"
                      className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>

              {/* نوار تعیین تکلیف تسک (انتقال به آرشیو پایین صفحه یا درج در فرم گزارش وسط صفحه) */}
              <div className="pt-2 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2">
                <span className="text-[11px] font-semibold text-slate-600">
                  تعیین تکلیف این تسک:
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
                    <span>انجام شد (انتقال به آرشیو پایین)</span>
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  // بخش ۲ (وسط صفحه - ویژه مدیر): فرم ارسال و تعریف تسک جدید برای پرسنل
  const renderManagerCreateSection = () =>
    role === 'manager' ? (
      <div className="rounded-2xl bg-white border border-[#C5A059]/50 p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Plus className="w-4 h-4 text-[#C5A059]" />
            <h3 className="text-xs sm:text-sm font-bold text-[#0B192C]">
              ارسال و تعریف تسک / وظیفه جدید برای پرسنل (امید میثمی)
            </h3>
          </div>
          <button
            type="button"
            onClick={() => setShowAddForm((s) => !s)}
            className="min-h-[32px] px-3 rounded-xl bg-[#FCF9F2] text-[#0B192C] border border-[#C5A059] text-xs font-bold hover:bg-[#C5A059]/20 cursor-pointer"
          >
            {showAddForm ? 'بستن فرم' : 'نمایش فرم ارسال تسک'}
          </button>
        </div>

        {showAddForm && (
          <form
            onSubmit={handleCreateTask}
            className="rounded-2xl bg-[#FCF9F2] border border-[#C5A059]/60 p-3.5 space-y-3"
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  عنوان تسک / وظیفه
                </label>
                <input
                  type="text"
                  required
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="مثلاً: آماده‌سازی سفارش مشتری..."
                  className="w-full min-h-[40px] rounded-xl border border-slate-200 bg-white px-3 text-xs focus:outline-none focus:border-[#0B192C]"
                />
              </div>
              <ShamsiDatePicker label="تاریخ انجام" value={newDate} onChange={setNewDate} />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                توضیحات تکمیلی (اختیاری)
              </label>
              <input
                type="text"
                value={newDesc}
                onChange={(e) => setNewDesc(e.target.value)}
                placeholder="جزئیات یا نکات لازم..."
                className="w-full min-h-[40px] rounded-xl border border-slate-200 bg-white px-3 text-xs focus:outline-none focus:border-[#0B192C]"
              />
            </div>
            <button
              type="submit"
              disabled={submitting}
              className="w-full min-h-[40px] rounded-xl bg-[#0B192C] text-[#C5A059] border border-[#C5A059] text-xs font-bold hover:bg-[#142844] cursor-pointer"
            >
              {submitting ? 'در حال ارسال...' : 'ارسال تسک جدید به پنل پرسنل'}
            </button>
          </form>
        )}
      </div>
    ) : null;

  // بخش ۳ (پایین صفحه): آرشیو تسک‌های تعیین تکلیف‌شده و انجام‌شده
  const renderArchivedSection = () => (
    <div className="rounded-2xl bg-white border border-slate-200 p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2">
        <div className="flex items-center gap-2">
          <CheckSquare className="w-4 h-4 text-emerald-600" />
          <div>
            <h3 className="text-xs sm:text-sm font-bold text-[#0B192C]">
              آرشیو تسک‌ها و وظایف انجام‌شده ({toPersianDigits(completedTasks.length)})
            </h3>
            <p className="text-[10.5px] text-slate-500 mt-0.5">
              تسک‌هایی که تعیین تکلیف و انجام شده‌اند در این بخش آرشیو می‌شوند.
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
          هنوز تسکی در آرشیو انجام‌شده‌ها ثبت نشده است.
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
                    تاریخ: {toPersianDigits(task.shamsi_date)} · وضعیت: انجام‌شده (آرشیو)
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
                    title="حذف تسک"
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

