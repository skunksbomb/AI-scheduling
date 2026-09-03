import { NextResponse } from "next/server";
import { getTasks, updateTask } from "@/lib/store";
import { deleteEvent } from "@/lib/googleCalendar";
import { todayStr, addDays } from "@/lib/dates";
import { quadrantRank, createDayBusyCache, placeInEarliestSlot } from "@/lib/scheduling";

function nowLocalStr() {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  return `${todayStr()}T${hh}:${mm}:00`;
}

// 완료 체크가 안 됐는데 배치된 시간이 이미 지나버린 '할 일'만 재배치 대상.
// 시각이 정해진 '일정'(다른 사람과의 약속 등)은 재배치하지 않는다.
function findMissedTasks(tasks) {
  const now = nowLocalStr();
  return tasks
    .filter((t) => t.type === "task" && !t.done && t.scheduledEnd && t.scheduledEnd < now)
    .sort((a, b) => quadrantRank(a) - quadrantRank(b));
}

export async function POST() {
  const tasks = getTasks();
  const missed = findMissedTasks(tasks);

  if (missed.length === 0) {
    return NextResponse.json({ rescheduled: 0, tasks });
  }

  const { getBusyForDay } = createDayBusyCache();
  const today = todayStr();
  let rescheduled = 0;

  for (const task of missed) {
    if (task.googleEventId) {
      await deleteEvent(task.googleEventId);
    }

    const toDateStr =
      task.deadline && task.deadline >= today ? task.deadline : addDays(today, 7);

    const placement = await placeInEarliestSlot({
      title: task.title,
      estimatedMinutes: task.estimatedMinutes,
      fromDateStr: today,
      toDateStr,
      getBusyForDay,
    });

    if (placement) {
      updateTask(task.id, {
        scheduledStart: placement.scheduledStart,
        scheduledEnd: placement.scheduledEnd,
        googleEventId: placement.googleEventId,
        scheduleError: null,
      });
      rescheduled += 1;
    } else {
      updateTask(task.id, {
        scheduledStart: null,
        scheduledEnd: null,
        googleEventId: null,
        scheduleError: `${today}부터 ${toDateStr}까지 빈 시간이 없어 재배치하지 못했습니다.`,
      });
    }
  }

  return NextResponse.json({ rescheduled, tasks: getTasks() });
}
