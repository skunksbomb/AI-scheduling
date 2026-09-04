import { NextResponse } from "next/server";
import { addTasks } from "@/lib/store";
import { listEvents } from "@/lib/googleCalendar";
import { commitNewTaskPlacement } from "@/lib/taskCommit";
import { addDays, formatKoreanDate, formatMinutesAsTime } from "@/lib/dates";
import { findTimeConflict } from "@/lib/placement";

export async function POST(request) {
  const { items, rawText } = await request.json();

  if (!Array.isArray(items) || items.length === 0) {
    return NextResponse.json({ error: "확정할 항목이 없습니다." }, { status: 400 });
  }

  // 미리보기와 확정 사이에 캘린더 상태가 바뀌었을 수 있으니 겹침만 가볍게
  // 재확인한다 (다른 시간을 새로 찾아주진 않고, 겹치면 시간만 제거).
  const dates = items.map((i) => i.scheduledDate);
  const from = dates.reduce((a, b) => (a < b ? a : b));
  const to = dates.reduce((a, b) => (a > b ? a : b));

  let busyEvents = [];
  try {
    busyEvents = await listEvents(`${from}T00:00:00+09:00`, `${addDays(to, 1)}T00:00:00+09:00`);
  } catch {
    // 재확인 실패는 무시하고 미리보기 시점 판단을 그대로 신뢰한다.
  }

  const recheckedItems = items.map((item) => {
    if (
      item.hasSuggestedTime &&
      findTimeConflict(item.scheduledDate, item.suggestedStartMinutes, item.suggestedEndMinutes, busyEvents)
    ) {
      return { ...item, hasSuggestedTime: false, suggestedStartMinutes: null, suggestedEndMinutes: null };
    }
    return item;
  });

  const newTasks = await Promise.all(recheckedItems.map((item) => commitNewTaskPlacement(item, rawText)));

  const summary = newTasks.map((base, i) => {
    const item = recheckedItems[i];
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

  const tasks = await addTasks(newTasks);
  return NextResponse.json({ tasks, summary });
}
