import { randomUUID } from "crypto";
import { createAllDayEvent } from "@/lib/googleCalendar";
import { createTask } from "@/lib/googleTasks";
import { addDays, formatMinutesAsTime } from "@/lib/dates";

// Google Tasks API는 시간을 저장 못 하므로(공식 문서로 확인됨), 제안된 시간은
// 제목에 사람이 보기 편한 텍스트로만 덧붙인다. 실제 시간 값은 Supabase의
// suggestedStartMinutes/EndMinutes가 진짜 저장소다 — title은 그걸 렌더링한 결과일 뿐.
export function formatGoogleTaskTitle({ title, hasSuggestedTime, suggestedStartMinutes, suggestedEndMinutes }) {
  if (!hasSuggestedTime || suggestedStartMinutes == null || suggestedEndMinutes == null) {
    return title;
  }
  return `${title} (${formatMinutesAsTime(suggestedStartMinutes)}~${formatMinutesAsTime(suggestedEndMinutes)})`;
}

// item: 원본 파싱 항목 + applyGuardrails가 채운 scheduledDate/hasSuggestedTime/... 을 가진 확정 항목.
// 실제로 Google Calendar/Tasks에 쓰고, Supabase에 넣을 수 있는 task row 객체를 반환한다.
export async function commitNewTaskPlacement(item, rawText) {
  const base = {
    id: randomUUID(),
    type: "task",
    title: item.title,
    deadline: item.deadline ?? null,
    exact: Boolean(item.exact),
    urgent: Boolean(item.urgent),
    important: Boolean(item.important),
    estimatedMinutes: item.estimatedMinutes ?? 60,
    done: false,
    rawText,
    createdAt: new Date().toISOString(),
    deadlineEventId: null,
    scheduledDate: null,
    suggestedStartMinutes: null,
    suggestedEndMinutes: null,
    googleTaskId: null,
    scheduleError: null,
  };

  try {
    // exact인 항목은 "이 날 하겠다"는 실행 날짜일 뿐 진짜 마감이 아니므로
    // 마감 표시 이벤트를 만들지 않는다.
    if (base.deadline && !item.exact) {
      const deadlineEvent = await createAllDayEvent({
        title: `🔔 마감: ${base.title}`,
        dateStr: base.deadline,
        nextDateStr: addDays(base.deadline, 1),
      });
      base.deadlineEventId = deadlineEvent.id;
    }

    const googleTitle = formatGoogleTaskTitle(item);
    const task = await createTask({ title: googleTitle, dueDateStr: item.scheduledDate });
    base.scheduledDate = item.scheduledDate;
    base.suggestedStartMinutes = item.hasSuggestedTime ? item.suggestedStartMinutes : null;
    base.suggestedEndMinutes = item.hasSuggestedTime ? item.suggestedEndMinutes : null;
    base.googleTaskId = task.id;
  } catch (err) {
    base.scheduleError = err.message;
  }

  return base;
}
