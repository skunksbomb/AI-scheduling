import { randomUUID } from "crypto";
import { createEvent, createAllDayEvent, updateEvent, deleteEvent } from "@/lib/googleCalendar";
import { createTask, patchTask, deleteTask as deleteGoogleTask } from "@/lib/googleTasks";
import { addDays, toLocalDateTime, formatKoreanDate, formatMinutesAsTime, parseStartTime } from "@/lib/dates";
import { isInvalidGrantError } from "@/lib/googleAuth";
import { getTasks, updateTask, deleteTaskRow } from "@/lib/store";
import { buildRecurrenceRule } from "@/lib/recurrence";

const REAUTH_MESSAGE = "Google 인증이 만료됐어요. 다시 로그인해주세요.";

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
export async function commitNewTaskPlacement(refreshToken, item, rawText) {
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
      const deadlineEvent = await createAllDayEvent(refreshToken, {
        title: `🔔 마감: ${base.title}`,
        dateStr: base.deadline,
        nextDateStr: addDays(base.deadline, 1),
      });
      base.deadlineEventId = deadlineEvent.id;
    }

    const googleTitle = formatGoogleTaskTitle(item);
    const task = await createTask(refreshToken, { title: googleTitle, dueDateStr: item.scheduledDate });
    base.scheduledDate = item.scheduledDate;
    base.suggestedStartMinutes = item.hasSuggestedTime ? item.suggestedStartMinutes : null;
    base.suggestedEndMinutes = item.hasSuggestedTime ? item.suggestedEndMinutes : null;
    base.googleTaskId = task.id;
  } catch (err) {
    base.scheduleError = isInvalidGrantError(err) ? REAUTH_MESSAGE : err.message;
  }

  return base;
}

// item: parseDumpText가 만든 event 항목. Google Calendar에 실제로 쓰고, 알림에
// 쓸 수 있는 결과 요약(성공 여부 + 표시용 문구)을 반환한다. Supabase엔 안 남긴다.
export async function commitEventItem(refreshToken, item) {
  const title = item.title;
  const estimatedMinutes = item.estimatedMinutes ?? 60;
  const recurrence = item.recurring
    ? buildRecurrenceRule({ freq: item.recurrenceFreq, untilDateStr: item.recurrenceUntil })
    : null;
  const recurrenceNote = recurrence ? " (반복 일정으로 등록됨)" : "";

  try {
    if (!item.hasTime) {
      const dateMatch = String(item.startTime).match(/^(\d{4}-\d{2}-\d{2})/);
      if (!dateMatch) throw new Error("날짜 형식을 해석하지 못했습니다.");
      const dateStr = dateMatch[1];
      await createAllDayEvent(refreshToken, { title, dateStr, nextDateStr: addDays(dateStr, 1), recurrence });
      return {
        ok: true,
        summary: `📅 ${formatKoreanDate(dateStr)} 하루종일 "${title}" 일정 배치 완료${recurrenceNote}`,
      };
    }

    const parsedStart = parseStartTime(item.startTime);
    if (!parsedStart) throw new Error("시간 형식을 해석하지 못했습니다.");

    const endMinutes = parsedStart.minutes + estimatedMinutes;
    const startISO = toLocalDateTime(parsedStart.dateStr, parsedStart.minutes);
    const endISO = toLocalDateTime(parsedStart.dateStr, endMinutes);
    await createEvent(refreshToken, { title, startISO, endISO, recurrence });

    return {
      ok: true,
      summary: `📅 ${formatKoreanDate(parsedStart.dateStr)} ${formatMinutesAsTime(
        parsedStart.minutes
      )}~${formatMinutesAsTime(endMinutes)} "${title}" 일정 배치 완료${recurrenceNote}`,
    };
  } catch (err) {
    const reason = isInvalidGrantError(err) ? REAUTH_MESSAGE : "";
    return { ok: false, summary: `⚠️ "${title}" 일정 배치 실패${reason ? `: ${reason}` : ""}` };
  }
}

// item: lib/existingItemDrafts.js가 만든 op: "delete" draft. 일정은 캘린더
// 이벤트만 지우면 끝. 할일은 구글 Task를 지우고, 매트릭스에서 추적 중이던
// Supabase row가 있으면 같이 지운다 (마감표시 🔔 이벤트는 매트릭스 삭제와
// 동일하게 일부러 남긴다 — "다가오는 마감"은 캘린더에서 직접 읽으므로).
export async function commitDeleteItem(userId, refreshToken, item) {
  try {
    if (item.kind === "event") {
      await deleteEvent(refreshToken, item.existingId);
    } else {
      await deleteGoogleTask(refreshToken, item.existingId);
      const tasks = await getTasks(userId);
      const row = tasks.find((t) => t.googleTaskId === item.existingId);
      if (row) await deleteTaskRow(userId, row.id);
    }
    return { ok: true, summary: `🗑 "${item.title}" 삭제 완료` };
  } catch (err) {
    const reason = isInvalidGrantError(err) ? REAUTH_MESSAGE : err.message;
    return { ok: false, summary: `⚠️ "${item.title}" 삭제 실패: ${reason}` };
  }
}

// item: lib/existingItemDrafts.js가 만든 op: "edit" draft.
export async function commitEditItem(userId, refreshToken, item) {
  try {
    if (item.kind === "event") {
      if (item.hasTime) {
        const parsed = parseStartTime(item.startTime);
        if (!parsed) throw new Error("시간 형식을 해석하지 못했습니다.");
        const endMinutes = parsed.minutes + (item.estimatedMinutes ?? 60);
        await updateEvent(refreshToken, item.existingId, {
          title: item.title,
          startISO: toLocalDateTime(parsed.dateStr, parsed.minutes),
          endISO: toLocalDateTime(parsed.dateStr, endMinutes),
        });
      } else {
        const dateMatch = String(item.startTime).match(/^(\d{4}-\d{2}-\d{2})/);
        if (!dateMatch) throw new Error("날짜 형식을 해석하지 못했습니다.");
        const dateStr = dateMatch[1];
        await updateEvent(refreshToken, item.existingId, {
          title: item.title,
          dateStr,
          nextDateStr: addDays(dateStr, 1),
        });
      }
      return { ok: true, summary: `✏️ "${item.title}" 일정 수정 완료` };
    }

    // 매트릭스에서 추적 중인 row가 있으면 "마감"은 Supabase deadline + 캘린더
    // 🔔 이벤트가 진짜 저장소다 (구글 Task의 due는 AI가 고른 실행일이라는
    // 별개 개념이라 안 건드림). 추적 안 되는 할일은 구글 Task 자체엔 "마감"
    // 이라는 별도 필드가 없고 due 하나뿐이라, 그 due를 직접 바꾼다 —
    // lib/existingItems.js가 이 둘을 구분해서 AI에게 보여주는 것과 짝을 이룬다.
    const tasks = await getTasks(userId);
    const row = tasks.find((t) => t.googleTaskId === item.existingId);

    if (row) {
      await patchTask(refreshToken, item.existingId, { title: item.title });
      const patch = { title: item.title };
      if (item.deadline !== row.deadline) {
        if (row.deadlineEventId) await deleteEvent(refreshToken, row.deadlineEventId);
        if (item.deadline) {
          const deadlineEvent = await createAllDayEvent(refreshToken, {
            title: `🔔 마감: ${item.title}`,
            dateStr: item.deadline,
            nextDateStr: addDays(item.deadline, 1),
          });
          patch.deadlineEventId = deadlineEvent.id;
        } else {
          patch.deadlineEventId = null;
        }
        patch.deadline = item.deadline;
      }
      await updateTask(userId, row.id, patch);
    } else {
      await patchTask(refreshToken, item.existingId, { title: item.title, dueDateStr: item.deadline ?? undefined });
    }

    return { ok: true, summary: `✏️ "${item.title}" 할 일 수정 완료` };
  } catch (err) {
    const reason = isInvalidGrantError(err) ? REAUTH_MESSAGE : err.message;
    return { ok: false, summary: `⚠️ "${item.title}" 수정 실패: ${reason}` };
  }
}
