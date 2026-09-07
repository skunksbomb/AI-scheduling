"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/clientFetch";
import { toDateStr, formatMinutesAsTime } from "@/lib/dates";
import { useTaskDone } from "@/lib/taskDoneContext";

const WEEKDAY_NAMES = ["일", "월", "화", "수", "목", "금", "토"];

function buildGrid(year, month) {
  // month: 1~12
  const firstOfMonth = new Date(year, month - 1, 1);
  const startWeekday = firstOfMonth.getDay();
  const daysInMonth = new Date(year, month, 0).getDate();
  const totalCells = Math.ceil((startWeekday + daysInMonth) / 7) * 7;

  const days = [];
  for (let i = 0; i < totalCells; i++) {
    const d = new Date(year, month - 1, 1 - startWeekday + i);
    days.push({ date: d, dateStr: toDateStr(d), inMonth: d.getMonth() === month - 1 });
  }

  const weeks = [];
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));
  return weeks;
}

function eventLabel(event) {
  if (event.start.date) return event.summary ?? "(제목 없음)";
  const start = new Date(event.start.dateTime);
  const time = formatMinutesAsTime(start.getHours() * 60 + start.getMinutes());
  return `${time} ${event.summary ?? "(제목 없음)"}`;
}

// 구글 캘린더처럼 일정은 채워진 파란 박스로, 할 일은 테두리만 있는
// 초록 계열로 표시해서 한눈에 구별되게 한다.
function CalendarChip({ item, doneOverrides }) {
  if (item.kind === "task") {
    const done = doneOverrides[item.taskId] ?? item.done;
    return (
      <div
        className={`truncate rounded border border-emerald-400 bg-emerald-50 px-1 py-0.5 text-[10px] text-emerald-700 ${
          done ? "line-through opacity-60" : ""
        }`}
        title={item.label}
      >
        ☐ {item.label}
      </div>
    );
  }
  return (
    <div className="truncate rounded bg-blue-600 px-1 py-0.5 text-[10px] text-white" title={item.label}>
      {item.label}
    </div>
  );
}

export default function MonthCalendar() {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [itemsByDate, setItemsByDate] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const { doneOverrides } = useTaskDone();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    apiFetch(`/api/calendar-month?year=${year}&month=${month}`)
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        if (data.error) throw new Error(data.error);

        const grouped = {};
        const add = (dateStr, item) => {
          if (!grouped[dateStr]) grouped[dateStr] = [];
          grouped[dateStr].push(item);
        };

        for (const event of data.events ?? []) {
          const dateStr = event.start.date ?? toDateStr(new Date(event.start.dateTime));
          add(dateStr, { id: `event-${event.id}`, kind: "event", label: eventLabel(event) });
        }
        for (const task of data.tasks ?? []) {
          if (!task.due) continue;
          add(task.due.slice(0, 10), {
            id: `task-${task.id}`,
            taskId: task.id,
            kind: "task",
            label: task.title || "(제목 없음)",
            done: task.status === "completed",
          });
        }

        setItemsByDate(grouped);
      })
      .catch((err) => !cancelled && setError(err.message))
      .finally(() => !cancelled && setLoading(false));

    return () => {
      cancelled = true;
    };
  }, [year, month]);

  function changeMonth(delta) {
    let m = month + delta;
    let y = year;
    if (m < 1) {
      m = 12;
      y -= 1;
    } else if (m > 12) {
      m = 1;
      y += 1;
    }
    setYear(y);
    setMonth(m);
  }

  const weeks = buildGrid(year, month);
  const todayStr = toDateStr(today);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <button
          onClick={() => changeMonth(-1)}
          className="rounded-full border border-zinc-300 px-3 py-1 text-sm text-zinc-600 hover:bg-zinc-100"
          aria-label="이전 달"
        >
          ◀
        </button>
        <h2 className="text-sm font-semibold text-zinc-700">
          {year}년 {month}월
        </h2>
        <button
          onClick={() => changeMonth(1)}
          className="rounded-full border border-zinc-300 px-3 py-1 text-sm text-zinc-600 hover:bg-zinc-100"
          aria-label="다음 달"
        >
          ▶
        </button>
      </div>

      <div className="flex gap-4 text-[10px] text-zinc-500">
        <span className="flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded-sm bg-blue-600" /> 일정
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded-sm border border-emerald-400 bg-emerald-50" /> 할 일
        </span>
      </div>

      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">불러오지 못했습니다: {error}</p>}

      {!error && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] table-fixed border-collapse text-xs">
            <thead>
              <tr>
                {WEEKDAY_NAMES.map((w) => (
                  <th key={w} className="w-[14.28%] border border-zinc-200 bg-zinc-50 py-1 text-zinc-500">
                    {w}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {weeks.map((week, i) => (
                <tr key={i}>
                  {week.map((day) => (
                    <td
                      key={day.dateStr}
                      className={`h-24 align-top p-1 ${
                        day.dateStr === todayStr
                          ? "border-2 border-purple-500 bg-purple-100"
                          : day.inMonth
                            ? "border border-zinc-200 bg-white"
                            : "border border-zinc-200 bg-zinc-50 text-zinc-300"
                      }`}
                    >
                      <div
                        className={`mb-1 text-[11px] ${
                          day.dateStr === todayStr ? "font-bold text-purple-700" : "text-zinc-500"
                        }`}
                      >
                        {day.date.getDate()}
                      </div>
                      <div className="flex flex-col gap-0.5">
                        {(itemsByDate[day.dateStr] ?? []).map((item) => (
                          <CalendarChip key={item.id} item={item} doneOverrides={doneOverrides} />
                        ))}
                      </div>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {loading && <p className="text-xs text-zinc-400">불러오는 중...</p>}
    </div>
  );
}
