import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { addTasks, getTasks } from "@/lib/store";
import { parseDumpText } from "@/lib/ai";
import { createEvent, createAllDayEvent } from "@/lib/googleCalendar";
import { createTask } from "@/lib/googleTasks";
import { todayStr, addDays, toLocalDateTime } from "@/lib/dates";
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

  let parsedItems;
  try {
    parsedItems = await parseDumpText(text);
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }

  // 중요한 일부터 먼저 빈 자리를 차지하도록 아이젠하워 우선순위로 정렬
  const sortedItems = [...parsedItems].sort(
    (a, b) => quadrantRank(a) - quadrantRank(b)
  );

  const dayCounts = buildDayCounts(await getTasks());
  const newTasks = [];

  for (const item of sortedItems) {
    const base = {
      id: randomUUID(),
      type: item.type === "event" ? "event" : "task",
      title: item.title ?? text,
      deadline: item.deadline ?? null,
      urgent: Boolean(item.urgent),
      important: Boolean(item.important),
      estimatedMinutes: item.estimatedMinutes ?? 60,
      done: false,
      rawText: text,
      createdAt: new Date().toISOString(),
      // event(약속) 전용
      scheduledStart: null,
      scheduledEnd: null,
      googleEventId: null,
      // task(할 일) 전용
      deadlineEventId: null,
      scheduledDate: null,
      googleTaskId: null,
      scheduleError: null,
    };

    try {
      if (base.type === "event" && item.startTime) {
        // 사람과의 약속 등 시각이 정해진 항목: 지정된 시간에 '일정'으로 그대로 배치
        const parsedStart = parseStartTime(item.startTime);
        if (!parsedStart) throw new Error("시간 형식을 해석하지 못했습니다.");

        const endMinutes = parsedStart.minutes + base.estimatedMinutes;
        const startISO = toLocalDateTime(parsedStart.dateStr, parsedStart.minutes);
        const endISO = toLocalDateTime(parsedStart.dateStr, endMinutes);

        const event = await createEvent({ title: base.title, startISO, endISO });

        base.scheduledStart = startISO;
        base.scheduledEnd = endISO;
        base.googleEventId = event.id;
      } else {
        // 마감일이 있는 할 일: 마감일에 '일정'으로 마감 표시(하루 종일)를 남기고,
        // 실제 작업 자체는 '할 일'(Google Tasks)로 오늘~마감일 사이 하루 최대
        // MAX_TASKS_PER_DAY개까지만 분산해서 등록한다. 시간은 정하지 않는다.
        if (base.deadline) {
          const deadlineEvent = await createAllDayEvent({
            title: `🔔 마감: ${base.title}`,
            dateStr: base.deadline,
            nextDateStr: addDays(base.deadline, 1),
          });
          base.deadlineEventId = deadlineEvent.id;
        }

        const toDateStr = base.deadline ?? todayStr();
        const day = pickDayWithCapacity({
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
      }
    } catch (err) {
      base.scheduleError = err.message;
    }

    newTasks.push(base);
  }

  const tasks = await addTasks(newTasks);
  return NextResponse.json({ tasks });
}
