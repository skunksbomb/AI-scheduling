import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { addTasks } from "@/lib/store";
import { parseDumpText } from "@/lib/ai";
import {
  createEvent,
  createAllDayEvent,
  getBusyMinutesForDay,
  findFreeSlot,
} from "@/lib/googleCalendar";
import { todayStr, addDays } from "@/lib/dates";

function quadrantRank(item) {
  if (item.urgent && item.important) return 0; // 긴급 & 중요
  if (!item.urgent && item.important) return 1; // 중요 & 안 긴급
  if (item.urgent && !item.important) return 2; // 긴급 & 안 중요
  return 3; // 안 긴급 & 안 중요
}

function parseStartTime(startTime) {
  const match = String(startTime).match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/);
  if (!match) return null;
  const [, dateStr, hh, mm] = match;
  return { dateStr, minutes: Number(hh) * 60 + Number(mm) };
}

function toLocalDateTime(dateStr, minutesFromMidnight) {
  const hh = String(Math.floor(minutesFromMidnight / 60)).padStart(2, "0");
  const mm = String(minutesFromMidnight % 60).padStart(2, "0");
  return `${dateStr}T${hh}:${mm}:00`;
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

  // 중요한 일부터 먼저 빈 시간을 차지하도록 아이젠하워 우선순위로 정렬
  const sortedItems = [...parsedItems].sort(
    (a, b) => quadrantRank(a) - quadrantRank(b)
  );

  const busyCache = new Map(); // dateStr -> busy 구간 배열(분 단위), 이번 배치에서 누적

  async function getBusyForDay(dateStr) {
    if (!busyCache.has(dateStr)) {
      const busy = await getBusyMinutesForDay(dateStr);

      if (dateStr === todayStr()) {
        // 오늘은 이미 지난 시각에 배치되지 않도록 자정~현재까지를 busy로 막는다.
        const now = new Date();
        const nowMinutes = now.getHours() * 60 + now.getMinutes();
        const roundedNow = Math.ceil(nowMinutes / 15) * 15;
        busy.push({ start: 0, end: roundedNow });
      }

      busyCache.set(dateStr, busy);
    }
    return busyCache.get(dateStr);
  }

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
      scheduledStart: null,
      scheduledEnd: null,
      googleEventId: null,
      deadlineEventId: null,
      scheduleError: null,
    };

    try {
      if (base.type === "event" && item.startTime) {
        // 사람과의 약속 등 시각이 정해진 항목: 지정된 시간에 그대로 배치
        const parsedStart = parseStartTime(item.startTime);
        if (!parsedStart) throw new Error("시간 형식을 해석하지 못했습니다.");

        const endMinutes = parsedStart.minutes + base.estimatedMinutes;
        const startISO = toLocalDateTime(parsedStart.dateStr, parsedStart.minutes);
        const endISO = toLocalDateTime(parsedStart.dateStr, endMinutes);

        const event = await createEvent({ title: base.title, startISO, endISO });

        base.scheduledStart = startISO;
        base.scheduledEnd = endISO;
        base.googleEventId = event.id;

        const busy = await getBusyForDay(parsedStart.dateStr);
        busy.push({ start: parsedStart.minutes, end: endMinutes });
      } else {
        // 마감일만 있는 할 일: 마감일에는 "마감" 표시(하루 종일 이벤트)만 남기고,
        // 실제로 할 일을 처리할 시간은 오늘부터 마감일까지 중 가장 빠른 빈 시간에 미리 배치한다.
        if (base.deadline) {
          const deadlineEvent = await createAllDayEvent({
            title: `🔔 마감: ${base.title}`,
            dateStr: base.deadline,
            nextDateStr: addDays(base.deadline, 1),
          });
          base.deadlineEventId = deadlineEvent.id;
        }

        const searchEnd = base.deadline ?? todayStr();
        let day = todayStr();
        let placed = false;

        while (!placed && day <= searchEnd) {
          const busy = await getBusyForDay(day);
          const slot = findFreeSlot(busy, base.estimatedMinutes);

          if (slot) {
            const startISO = toLocalDateTime(day, slot.start);
            const endISO = toLocalDateTime(day, slot.end);
            const event = await createEvent({ title: base.title, startISO, endISO });

            base.scheduledStart = startISO;
            base.scheduledEnd = endISO;
            base.googleEventId = event.id;
            busy.push(slot);
            placed = true;
          } else {
            day = addDays(day, 1);
          }
        }

        if (!placed) {
          base.scheduleError = base.deadline
            ? `오늘부터 ${base.deadline}까지 빈 시간이 없어 배치하지 못했습니다.`
            : `${searchEnd}에 빈 시간이 없어 배치하지 못했습니다.`;
        }
      }
    } catch (err) {
      base.scheduleError = err.message;
    }

    newTasks.push(base);
  }

  const tasks = addTasks(newTasks);
  return NextResponse.json({ tasks });
}
