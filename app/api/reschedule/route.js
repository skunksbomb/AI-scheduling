import { NextResponse } from "next/server";
import { getTasks, updateTask, getUserContext } from "@/lib/store";
import { deleteTask, createTask } from "@/lib/googleTasks";
import { listEvents } from "@/lib/googleCalendar";
import { todayStr, addDays } from "@/lib/dates";
import { quadrantRank, buildDayCounts, pickDayWithCapacity } from "@/lib/scheduling";
import { suggestPlacements, applyGuardrails } from "@/lib/placement";
import { formatGoogleTaskTitle } from "@/lib/taskCommit";

const FALLBACK_MAX_TASKS_PER_DAY = 4;
const DEFAULT_WINDOW_DAYS = 7;

// 완료 체크가 안 됐는데 예정일이 이미 지나버린 '할 일'만 재배치 대상.
// 시각이 정해진 '일정'(다른 사람과의 약속 등)은 재배치하지 않는다.
function findMissedTasks(tasks) {
  const today = todayStr();
  return tasks
    .filter((t) => t.type === "task" && !t.done && t.scheduledDate && t.scheduledDate < today)
    .sort((a, b) => quadrantRank(a) - quadrantRank(b));
}

export async function POST() {
  const tasks = await getTasks();
  const missed = findMissedTasks(tasks);

  if (missed.length === 0) {
    return NextResponse.json({ rescheduled: 0, tasks });
  }

  const today = todayStr();
  const others = tasks.filter((t) => !missed.includes(t));
  const deadlines = missed.map((t) => t.deadline).filter(Boolean);
  const windowTo =
    deadlines.length > 0
      ? deadlines.reduce((a, b) => (a > b ? a : b))
      : addDays(today, DEFAULT_WINDOW_DAYS);

  let finalized;
  try {
    const [busyEvents] = await Promise.all([
      listEvents(`${today}T00:00:00+09:00`, `${addDays(windowTo, 1)}T00:00:00+09:00`),
    ]);
    const busyTasks = others.filter(
      (t) => t.scheduledDate && t.scheduledDate >= today && t.scheduledDate <= windowTo && !t.done
    );
    const userContext = await getUserContext();
    const placements = await suggestPlacements({ items: missed, busyEvents, busyTasks, windowTo, userContext });
    finalized = applyGuardrails({ items: missed, placements, busyEvents });
  } catch {
    // AI 배치 제안 실패 시 예전의 기계적 분산 방식으로 대체한다.
    const dayCounts = buildDayCounts(others);
    finalized = missed.map((task) => {
      const toDateStr = task.deadline && task.deadline >= today ? task.deadline : addDays(today, DEFAULT_WINDOW_DAYS);
      const day =
        task.exact && task.deadline
          ? task.deadline
          : pickDayWithCapacity({
              fromDateStr: today,
              toDateStr,
              maxPerDay: FALLBACK_MAX_TASKS_PER_DAY,
              dayCounts,
            });
      if (day) dayCounts.set(day, (dayCounts.get(day) ?? 0) + 1);
      return {
        ...task,
        scheduledDate: day,
        hasSuggestedTime: false,
        suggestedStartMinutes: null,
        suggestedEndMinutes: null,
        warning: day ? null : `${today}부터 ${toDateStr}까지 이미 꽉 찼습니다.`,
      };
    });
  }

  let rescheduled = 0;

  for (const item of finalized) {
    if (item.googleTaskId) {
      await deleteTask(item.googleTaskId);
    }

    if (!item.scheduledDate) {
      await updateTask(item.id, {
        scheduledDate: null,
        suggestedStartMinutes: null,
        suggestedEndMinutes: null,
        googleTaskId: null,
        scheduleError: item.warning ?? "재배치할 자리를 찾지 못했습니다.",
      });
      continue;
    }

    try {
      const googleTask = await createTask({
        title: formatGoogleTaskTitle(item),
        dueDateStr: item.scheduledDate,
      });
      await updateTask(item.id, {
        scheduledDate: item.scheduledDate,
        suggestedStartMinutes: item.hasSuggestedTime ? item.suggestedStartMinutes : null,
        suggestedEndMinutes: item.hasSuggestedTime ? item.suggestedEndMinutes : null,
        googleTaskId: googleTask.id,
        scheduleError: null,
      });
      rescheduled += 1;
    } catch (err) {
      await updateTask(item.id, {
        scheduledDate: null,
        suggestedStartMinutes: null,
        suggestedEndMinutes: null,
        googleTaskId: null,
        scheduleError: err.message,
      });
    }
  }

  return NextResponse.json({ rescheduled, tasks: await getTasks() });
}
