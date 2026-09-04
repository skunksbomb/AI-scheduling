import { NextResponse } from "next/server";
import { getUserContext } from "@/lib/store";
import { parseDumpText } from "@/lib/ai";
import { createEvent, createAllDayEvent } from "@/lib/googleCalendar";
import { addDays, toLocalDateTime, formatKoreanDate, formatMinutesAsTime } from "@/lib/dates";
import { quadrantRank } from "@/lib/scheduling";
import { buildTaskDraft } from "@/lib/placement";

function parseStartTime(startTime) {
  const match = String(startTime).match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/);
  if (!match) return null;
  const [, dateStr, hh, mm] = match;
  return { dateStr, minutes: Number(hh) * 60 + Number(mm) };
}

export async function POST(request) {
  const { text } = await request.json();

  if (!text || !text.trim()) {
    return NextResponse.json({ error: "내용을 입력해주세요." }, { status: 400 });
  }

  const userContext = await getUserContext();

  let parsedItems, uncertain, reason;
  try {
    ({ tasks: parsedItems, uncertain, reason } = await parseDumpText(text, userContext));
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }

  // 중요한 일부터 먼저 처리되도록 아이젠하워 우선순위로 정렬
  const sortedItems = [...parsedItems].sort((a, b) => quadrantRank(a) - quadrantRank(b));
  const eventItems = sortedItems.filter((item) => item.type === "event" && item.startTime);
  const taskItems = sortedItems.filter((item) => !(item.type === "event" && item.startTime));

  const summary = [];

  // 일정(event)은 사용자가 날짜/시간을 직접 말한 것이라 모호함이 없으므로
  // 지금처럼 즉시 커밋한다 (확인 절차 대상 아님).
  for (const item of eventItems) {
    const title = item.title ?? text;
    const estimatedMinutes = item.estimatedMinutes ?? 60;
    try {
      if (!item.hasTime) {
        const dateMatch = String(item.startTime).match(/^(\d{4}-\d{2}-\d{2})/);
        if (!dateMatch) throw new Error("날짜 형식을 해석하지 못했습니다.");
        const dateStr = dateMatch[1];
        await createAllDayEvent({ title, dateStr, nextDateStr: addDays(dateStr, 1) });
        summary.push(`📅 ${formatKoreanDate(dateStr)} 하루종일 "${title}" 일정 배치 완료`);
      } else {
        const parsedStart = parseStartTime(item.startTime);
        if (!parsedStart) throw new Error("시간 형식을 해석하지 못했습니다.");

        const endMinutes = parsedStart.minutes + estimatedMinutes;
        const startISO = toLocalDateTime(parsedStart.dateStr, parsedStart.minutes);
        const endISO = toLocalDateTime(parsedStart.dateStr, endMinutes);

        await createEvent({ title, startISO, endISO });
        summary.push(
          `📅 ${formatKoreanDate(parsedStart.dateStr)} ${formatMinutesAsTime(
            parsedStart.minutes
          )}~${formatMinutesAsTime(endMinutes)} "${title}" 일정 배치 완료`
        );
      }
    } catch {
      summary.push(`⚠️ "${title}" 일정 배치 실패`);
    }
  }

  // 할일(task)은 AI가 실제 캘린더를 보고 배치를 제안하게 하고, 아직 아무데도
  // 쓰지 않은 채 사용자 확인용 draft로만 돌려준다. 확정은 /api/dump/confirm에서.
  let taskDraft = null;

  if (taskItems.length > 0) {
    const { items, placementFallback } = await buildTaskDraft({ taskItems, userContext });
    taskDraft = { items, placementFallback, rawText: text };
  }

  return NextResponse.json({ uncertain, reason, summary, taskDraft });
}
