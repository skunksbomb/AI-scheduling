import { listEvents } from "@/lib/googleCalendar";
import { listTasksDueOn } from "@/lib/googleTasks";
import { todayStr, addDays, formatKoreanDate } from "@/lib/dates";

const WEEKDAY_NAMES = ["일", "월", "화", "수", "목", "금", "토"];

// "다가오는 마감"은 Supabase 할 일 row가 아니라 캘린더의 마감 표시 이벤트에서
// 직접 읽는다 — "여기 뜬다" == "마감 이벤트가 실제로 존재한다"가 되도록.
// (할 일만 지워지고 마감 이벤트는 남아있는 경우에도 계속 보여야 한다)
const DEADLINE_PREFIX = "🔔 마감:";
const UPCOMING_WINDOW_DAYS = 60;

function formatTimeRange(event) {
  if (event.start.date) return "하루종일";
  const start = new Date(event.start.dateTime);
  const end = new Date(event.end.dateTime);
  const fmt = (d) =>
    `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  return `${fmt(start)} - ${fmt(end)}`;
}

function formatDday(deadline, today) {
  const diffDays = Math.round(
    (new Date(deadline) - new Date(today)) / (24 * 60 * 60 * 1000)
  );
  if (diffDays === 0) return "D-day";
  return `D-${diffDays}`;
}

export default async function Home() {
  const today = todayStr();
  const weekday = WEEKDAY_NAMES[new Date().getDay()];

  let tasks = [];
  let events = [];
  let upcomingDeadlines = [];
  let error = null;
  try {
    let deadlineEvents;
    [tasks, events, deadlineEvents] = await Promise.all([
      listTasksDueOn(today),
      listEvents(`${today}T00:00:00+09:00`, `${today}T23:59:59+09:00`),
      listEvents(
        `${today}T00:00:00+09:00`,
        `${addDays(today, UPCOMING_WINDOW_DAYS)}T00:00:00+09:00`
      ),
    ]);

    upcomingDeadlines = deadlineEvents
      .filter((e) => (e.summary ?? "").startsWith(DEADLINE_PREFIX) && e.start?.date)
      .map((e) => ({
        id: e.id,
        title: e.summary.slice(DEADLINE_PREFIX.length).trim(),
        date: e.start.date,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));
  } catch (err) {
    error = err.message;
  }

  return (
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col gap-4 px-6 py-12">
      <div>
        <h1 className="text-xl font-semibold text-zinc-900">오늘 일정</h1>
        <p className="text-sm text-zinc-500">
          {today} ({weekday})
        </p>
      </div>

      {error && (
        <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
          캘린더를 불러오지 못했습니다: {error}
        </p>
      )}

      {!error && tasks.length > 0 && (
        <ul className="flex flex-col divide-y divide-zinc-200 rounded-lg border border-zinc-200 bg-white">
          {tasks.map((task) => {
            const done = task.status === "completed";
            return (
              <li key={task.id} className="flex items-center gap-3 px-4 py-3 text-sm">
                <span className="w-28 shrink-0 text-xs text-zinc-500">할 일</span>
                <span className={done ? "text-zinc-400 line-through" : "text-zinc-800"}>
                  {done ? "☑" : "☐"} {task.title}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {!error && events.length === 0 && (
        <p className="text-sm text-zinc-400">오늘 등록된 일정이 없습니다.</p>
      )}

      {!error && events.length > 0 && (
        <ul className="flex flex-col divide-y divide-zinc-200 rounded-lg border border-zinc-200 bg-white">
          {events.map((event) => (
            <li key={event.id} className="flex items-center gap-3 px-4 py-3 text-sm">
              <span className="w-28 shrink-0 font-mono text-xs text-zinc-500">
                {formatTimeRange(event)}
              </span>
              <span className="text-zinc-800">{event.summary}</span>
            </li>
          ))}
        </ul>
      )}

      {!error && (
        <div>
          <h2 className="mb-2 text-sm font-semibold text-zinc-700">다가오는 마감</h2>
          {upcomingDeadlines.length === 0 ? (
            <p className="text-sm text-zinc-400">다가오는 마감이 없습니다.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-zinc-200 rounded-lg border border-zinc-200 bg-white">
              {upcomingDeadlines.map((deadline) => (
                <li key={deadline.id} className="flex items-center gap-3 px-4 py-3 text-sm">
                  <span className="w-28 shrink-0 text-xs text-zinc-500">
                    {formatKoreanDate(deadline.date)}
                  </span>
                  <span className="flex-1 text-zinc-800">{deadline.title}</span>
                  <span className="shrink-0 font-mono text-xs text-red-500">
                    {formatDday(deadline.date, today)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
