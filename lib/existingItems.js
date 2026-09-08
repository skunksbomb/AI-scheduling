import { listEvents } from "@/lib/googleCalendar";
import { listTasksDueBetween } from "@/lib/googleTasks";
import { getTasks } from "@/lib/store";
import { todayStr, addDays } from "@/lib/dates";

const WINDOW_BEFORE_DAYS = 3;
const WINDOW_AFTER_DAYS = 60;
const DEADLINE_PREFIX = "🔔 마감:";

// dump에서 "화학보고서 마감 다음주로 바꿔줘" 같은 문장이 어떤 기존 항목을
// 가리키는지 AI가 대조할 수 있도록, 최근~다가오는 일정/할일 목록을 가져온다.
// 🔔 마감 표시 이벤트는 원래 할일을 통해서만 다루는 게 맞다(taskCommit.js가
// deadline 필드 변경 시 이 이벤트를 알아서 만들고/지운다) — 그래서 살아있는
// 할일에 연결된 마감 표시는 후보에서 뺀다. 다만 그 할일 자체가 이미 지워졌는데
// 마감 표시만 캘린더에 남아있는 경우(고아 상태)는 사용자가 직접 지울 방법이
// 없어지므로, 그런 경우는 예외적으로 후보에 넣어서 "이거 지워줘"가 통하게 한다.
//
// 할일의 "날짜"로 보여줄 값은 매트릭스 추적 여부에 따라 다르다:
// - 추적 중(Supabase row 있음): deadline(마감, 소프트 컷오프)이 진짜 개념이라
//   그걸 보여준다 — scheduledDate(AI가 고른 실행일)와는 다른 값일 수 있다.
// - 추적 안 됨(구글 Tasks에만 존재): 구글 Task 자체엔 "마감"이라는 별도
//   필드가 없고 due 하나뿐이라, 그 값을 그대로 보여준다.
// 이 구분을 안 하면(예전 버그) "마감을 바꿔줘"가 실제로는 scheduledDate 기준
// 날짜를 보고 판단해버려서, 진짜 마감일과 다른 값으로 헷갈릴 수 있었다.
export async function getExistingItems(userId, refreshToken) {
  const today = todayStr();
  const from = addDays(today, -WINDOW_BEFORE_DAYS);
  const to = addDays(today, WINDOW_AFTER_DAYS);

  const [events, tasks, trackedTasks] = await Promise.all([
    listEvents(refreshToken, `${from}T00:00:00+09:00`, `${to}T00:00:00+09:00`),
    listTasksDueBetween(refreshToken, from, to),
    getTasks(userId),
  ]);
  const trackedByGoogleId = new Map(trackedTasks.filter((t) => t.googleTaskId).map((t) => [t.googleTaskId, t]));
  const activeDeadlineEventIds = new Set(trackedTasks.filter((t) => t.deadlineEventId).map((t) => t.deadlineEventId));

  const items = [];
  for (const e of events) {
    const isDeadlineMarker = (e.summary ?? "").startsWith(DEADLINE_PREFIX);
    if (isDeadlineMarker && activeDeadlineEventIds.has(e.id)) continue;
    const dateStr = e.start.date ?? e.start.dateTime?.slice(0, 10) ?? null;
    items.push({
      kind: "event",
      id: e.id,
      title: e.summary || "(제목 없음)",
      dateStr,
      tracked: false,
      orphanedMarker: isDeadlineMarker,
    });
  }
  for (const t of tasks) {
    if (t.status === "completed") continue;
    const row = trackedByGoogleId.get(t.id);
    const dateStr = row ? row.deadline ?? row.scheduledDate ?? null : t.due?.slice(0, 10) ?? null;
    items.push({ kind: "task", id: t.id, title: t.title || "(제목 없음)", dateStr, tracked: Boolean(row) });
  }
  return items;
}

export function formatExistingItemsForPrompt(items) {
  if (items.length === 0) return "(현재 등록된 일정/할일 없음)";
  return items
    .map((item, i) => {
      const kindLabel = item.orphanedMarker ? "주인 없는 마감 표시" : item.kind === "event" ? "일정" : "할일";
      const dateLabel = item.kind === "task" ? (item.tracked ? "마감" : "날짜") : "날짜";
      return `[${i}] (${kindLabel}) "${item.title}" - ${dateLabel}: ${item.dateStr ?? "미정"}`;
    })
    .join("\n");
}
