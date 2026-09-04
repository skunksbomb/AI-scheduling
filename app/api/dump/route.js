import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { addTasks, getTasks } from "@/lib/store";
import { parseDumpText } from "@/lib/ai";
import { createEvent, createAllDayEvent } from "@/lib/googleCalendar";
import { createTask } from "@/lib/googleTasks";
import {
  todayStr,
  addDays,
  toLocalDateTime,
  formatKoreanDate,
  formatMinutesAsTime,
} from "@/lib/dates";
import { quadrantRank, buildDayCounts, pickDayWithCapacity } from "@/lib/scheduling";

const MAX_TASKS_PER_DAY = 4;

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

  let parsedItems, uncertain, reason;
  try {
    ({ tasks: parsedItems, uncertain, reason } = await parseDumpText(text));
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }

  // 중요한 일부터 먼저 빈 자리를 차지하도록 아이젠하워 우선순위로 정렬
  const sortedItems = [...parsedItems].sort(
    (a, b) => quadrantRank(a) - quadrantRank(b)
  );

  const dayCounts = buildDayCounts(await getTasks());
  const newTasks = [];
  const summary = [];

  for (const item of sortedItems) {
    const isEvent = item.type === "event" && item.startTime;
    const title = item.title ?? text;
    const estimatedMinutes = item.estimatedMinutes ?? 60;

    if (isEvent) {
      // 사람과의 약속 등 특정 날짜에 벌어지는 항목: Google Calendar에 그대로
      // 배치만 하고, 매트릭스 대상이 아니므로 Supabase에는 저장하지 않는다.
      try {
        // hasTime을 우선 신뢰한다: AI가 시각을 모르면서도 startTime에 00:00 같은
        // 시각을 지어내는 경우가 있어, startTime의 생김새만으로는 판단이 불안정하다.
        if (!item.hasTime) {
          // 시각 언급이 없는 일정: 하루종일 일정으로 배치.
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
        // 일정 생성 실패는 매트릭스에 남길 대상이 없어 조용히 넘어간다.
        summary.push(`⚠️ "${title}" 일정 배치 실패`);
      }
      continue;
    }

    // 마감일이 있는 할 일: 마감일에 '일정'으로 마감 표시(하루 종일)를 남기고,
    // 실제 작업 자체는 '할 일'(Google Tasks)로 오늘~마감일 사이 하루 최대
    // MAX_TASKS_PER_DAY개까지만 분산해서 등록한다. 시간은 정하지 않는다.
    const base = {
      id: randomUUID(),
      type: "task",
      title,
      deadline: item.deadline ?? null,
      urgent: Boolean(item.urgent),
      important: Boolean(item.important),
      estimatedMinutes,
      done: false,
      rawText: text,
      createdAt: new Date().toISOString(),
      deadlineEventId: null,
      scheduledDate: null,
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

      // exact: 사용자가 "정확히 이 날 하겠다"고 못박은 경우 분산배치 없이 그 날짜에 바로 배치.
      // 그 외엔 기존처럼 오늘~마감일 사이 빈 자리를 찾아 분산배치.
      const toDateStr = base.deadline ?? todayStr();
      const day =
        item.exact && base.deadline
          ? base.deadline
          : pickDayWithCapacity({
              fromDateStr: todayStr(),
              toDateStr,
              maxPerDay: MAX_TASKS_PER_DAY,
              dayCounts,
            });

      if (day) {
        const task = await createTask({ title: base.title, dueDateStr: day });
        base.scheduledDate = day;
        base.googleTaskId = task.id;
        dayCounts.set(day, (dayCounts.get(day) ?? 0) + 1);
      } else {
        base.scheduleError = `오늘부터 ${toDateStr}까지 하루 ${MAX_TASKS_PER_DAY}개씩 이미 꽉 찼습니다.`;
      }
    } catch (err) {
      base.scheduleError = err.message;
    }

    if (item.exact) {
      // exact는 마감이 아니라 "이 날 하겠다"는 실행일이므로, 그 날짜에 할 일로
      // 실제 배치됐는지를 알려준다.
      if (base.googleTaskId) {
        summary.push(
          `✅ ${formatKoreanDate(base.scheduledDate)} "${base.title}" 할 일 배치 완료`
        );
      } else {
        summary.push(`⚠️ "${base.title}" 배치 실패: ${base.scheduleError}`);
      }
    } else if (base.deadline) {
      // 그 외엔 '할 일(Google Tasks)' 배치가 아니라 '마감 일정' 배치 결과만 보여준다.
      if (base.deadlineEventId) {
        summary.push(
          `🔔 ${formatKoreanDate(base.deadline)} "${base.title}" 마감 일정 배치 완료`
        );
      } else {
        summary.push(`⚠️ "${base.title}" 마감 일정 배치 실패: ${base.scheduleError}`);
      }
    }

    newTasks.push(base);
  }

  const tasks = newTasks.length > 0 ? await addTasks(newTasks) : await getTasks();
  return NextResponse.json({ tasks, uncertain, reason, summary });
}
