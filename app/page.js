import { listEvents } from "@/lib/googleCalendar";
import { todayStr } from "@/lib/dates";

const WEEKDAY_NAMES = ["일", "월", "화", "수", "목", "금", "토"];

function formatTimeRange(event) {
  if (event.start.date) return "하루종일";
  const start = new Date(event.start.dateTime);
  const end = new Date(event.end.dateTime);
  const fmt = (d) =>
    `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  return `${fmt(start)} - ${fmt(end)}`;
}

export default async function Home() {
  const today = todayStr();
  const weekday = WEEKDAY_NAMES[new Date().getDay()];

  let events = [];
  let error = null;
  try {
    events = await listEvents(`${today}T00:00:00+09:00`, `${today}T23:59:59+09:00`);
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
    </div>
  );
}
