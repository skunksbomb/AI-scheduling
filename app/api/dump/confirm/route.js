import { NextResponse } from "next/server";
import { addTasks, getTasks } from "@/lib/store";
import { listEvents } from "@/lib/googleCalendar";
import { commitNewTaskPlacement, commitEventItem } from "@/lib/taskCommit";
import { addDays, formatKoreanDate, formatMinutesAsTime } from "@/lib/dates";
import { findTimeConflict } from "@/lib/placement";

export async function POST(request) {
  const { items, rawText } = await request.json();

  if (!Array.isArray(items) || items.length === 0) {
    return NextResponse.json({ error: "확정할 항목이 없습니다." }, { status: 400 });
  }

  const taskItems = items.filter((i) => i.type !== "event");
  const eventItems = items.filter((i) => i.type === "event");

  // 미리보기와 확정 사이에 캘린더 상태가 바뀌었을 수 있으니, 할일에 제안된
  // 시간대만 가볍게 재확인한다 (겹치면 시간만 제거하고, 다시 찾아주진 않는다).
  let recheckedTaskItems = taskItems;
  if (taskItems.length > 0) {
    const dates = taskItems.map((i) => i.scheduledDate);
    const from = dates.reduce((a, b) => (a < b ? a : b));
    const to = dates.reduce((a, b) => (a > b ? a : b));

    let busyEvents = [];
    try {
      busyEvents = await listEvents(`${from}T00:00:00+09:00`, `${addDays(to, 1)}T00:00:00+09:00`);
    } catch {
      // 재확인 실패는 무시하고 미리보기 시점 판단을 그대로 신뢰한다.
    }

    recheckedTaskItems = taskItems.map((item) => {
      if (
        item.hasSuggestedTime &&
        findTimeConflict(item.scheduledDate, item.suggestedStartMinutes, item.suggestedEndMinutes, busyEvents)
      ) {
        return { ...item, hasSuggestedTime: false, suggestedStartMinutes: null, suggestedEndMinutes: null };
      }
      return item;
    });
  }

  const [eventResults, newTasks] = await Promise.all([
    Promise.all(eventItems.map((item) => commitEventItem(item))),
    Promise.all(recheckedTaskItems.map((item) => commitNewTaskPlacement(item, rawText))),
  ]);

  const taskSummary = newTasks.map((base, i) => {
    const item = recheckedTaskItems[i];
    if (item.exact) {
      return base.googleTaskId
        ? `✅ ${formatKoreanDate(base.scheduledDate)} "${base.title}" 할 일 배치 완료`
        : `⚠️ "${base.title}" 배치 실패: ${base.scheduleError}`;
    }
    if (base.deadline) {
      return base.deadlineEventId
        ? `🔔 ${formatKoreanDate(base.deadline)} "${base.title}" 마감 일정 배치 완료`
        : `⚠️ "${base.title}" 마감 일정 배치 실패: ${base.scheduleError}`;
    }
    return base.googleTaskId
      ? `✅ ${formatKoreanDate(base.scheduledDate)}${
          base.suggestedStartMinutes != null
            ? ` ${formatMinutesAsTime(base.suggestedStartMinutes)}~${formatMinutesAsTime(base.suggestedEndMinutes)}`
            : ""
        } "${base.title}" 할 일 배치 완료`
      : `⚠️ "${base.title}" 배치 실패: ${base.scheduleError}`;
  });

  const summary = [...eventResults.map((r) => r.summary), ...taskSummary];
  const tasks = newTasks.length > 0 ? await addTasks(newTasks) : await getTasks();

  return NextResponse.json({ tasks, summary });
}
