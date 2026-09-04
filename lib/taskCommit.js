import { randomUUID } from "crypto";
import { createEvent, createAllDayEvent } from "@/lib/googleCalendar";
import { createTask } from "@/lib/googleTasks";
import { addDays, toLocalDateTime, formatKoreanDate, formatMinutesAsTime, parseStartTime } from "@/lib/dates";

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

// item: parseDumpText가 만든 event 항목. Google Calendar에 실제로 쓰고, 알림에
// 쓸 수 있는 결과 요약(성공 여부 + 표시용 문구)을 반환한다. Supabase엔 안 남긴다.
export async function commitEventItem(item) {
  const title = item.title;
  const estimatedMinutes = item.estimatedMinutes ?? 60;

  try {
    if (!item.hasTime) {
      const dateMatch = String(item.startTime).match(/^(\d{4}-\d{2}-\d{2})/);
      if (!dateMatch) throw new Error("날짜 형식을 해석하지 못했습니다.");
      const dateStr = dateMatch[1];
      await createAllDayEvent({ title, dateStr, nextDateStr: addDays(dateStr, 1) });
      return { ok: true, summary: `📅 ${formatKoreanDate(dateStr)} 하루종일 "${title}" 일정 배치 완료` };
    }

    const parsedStart = parseStartTime(item.startTime);
    if (!parsedStart) throw new Error("시간 형식을 해석하지 못했습니다.");

    const endMinutes = parsedStart.minutes + estimatedMinutes;
    const startISO = toLocalDateTime(parsedStart.dateStr, parsedStart.minutes);
    const endISO = toLocalDateTime(parsedStart.dateStr, endMinutes);
    await createEvent({ title, startISO, endISO });

    return {
      ok: true,
      summary: `📅 ${formatKoreanDate(parsedStart.dateStr)} ${formatMinutesAsTime(
        parsedStart.minutes
      )}~${formatMinutesAsTime(endMinutes)} "${title}" 일정 배치 완료`,
    };
  } catch {
    return { ok: false, summary: `⚠️ "${title}" 일정 배치 실패` };
  }
}
