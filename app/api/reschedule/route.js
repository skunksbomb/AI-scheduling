import { NextResponse } from "next/server";
import { getTasks, updateTask } from "@/lib/store";
import { deleteTask, createTask } from "@/lib/googleTasks";
import { todayStr, addDays } from "@/lib/dates";
import { quadrantRank, buildDayCounts, pickDayWithCapacity } from "@/lib/scheduling";

const MAX_TASKS_PER_DAY = 4;

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
  const dayCounts = buildDayCounts(tasks.filter((t) => !missed.includes(t)));
  let rescheduled = 0;

  for (const task of missed) {
    if (task.googleTaskId) {
      await deleteTask(task.googleTaskId);
    }

    const toDateStr =
      task.deadline && task.deadline >= today ? task.deadline : addDays(today, 7);

    const day = pickDayWithCapacity({
      fromDateStr: today,
      toDateStr,
      maxPerDay: MAX_TASKS_PER_DAY,
      dayCounts,
    });

    if (day) {
      const googleTask = await createTask({ title: task.title, dueDateStr: day });
      await updateTask(task.id, {
        scheduledDate: day,
        googleTaskId: googleTask.id,
        scheduleError: null,
      });
      dayCounts.set(day, (dayCounts.get(day) ?? 0) + 1);
      rescheduled += 1;
    } else {
      await updateTask(task.id, {
        scheduledDate: null,
        googleTaskId: null,
        scheduleError: `${today}부터 ${toDateStr}까지 하루 ${MAX_TASKS_PER_DAY}개씩 이미 꽉 찼습니다.`,
      });
    }
  }

  return NextResponse.json({ rescheduled, tasks: await getTasks() });
}
