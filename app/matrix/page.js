"use client";

import { useEffect, useState } from "react";

function formatScheduled(task) {
  if (task.type === "event" && task.scheduledStart) {
    const [datePart, timePart] = task.scheduledStart.split("T");
    const [, mo, da] = datePart.split("-");
    return `${mo}/${da} ${timePart.slice(0, 5)}`;
  }
  if (task.type === "task" && task.scheduledDate) {
    const [, mo, da] = task.scheduledDate.split("-");
    return `${mo}/${da} 하루종일`;
  }
  return null;
}

const QUADRANTS = [
  { key: "do", label: "긴급 & 중요 (즉시 처리)", urgent: true, important: true },
  { key: "schedule", label: "중요 & 안 긴급 (일정 잡기)", urgent: false, important: true },
  { key: "delegate", label: "긴급 & 안 중요 (짧게 처리)", urgent: true, important: false },
  { key: "eliminate", label: "안 긴급 & 안 중요 (나중에)", urgent: false, important: false },
];

export default function MatrixPage() {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [rescheduling, setRescheduling] = useState(false);
  const [rescheduleMessage, setRescheduleMessage] = useState("");

  async function loadTasks() {
    const res = await fetch("/api/tasks");
    const data = await res.json();
    setTasks(data.tasks || []);
    setLoading(false);
  }

  useEffect(() => {
    loadTasks();
  }, []);

  async function handleReschedule() {
    setRescheduling(true);
    setRescheduleMessage("");
    try {
      const res = await fetch("/api/reschedule", { method: "POST" });
      const data = await res.json();
      setTasks(data.tasks || []);
      setRescheduleMessage(
        data.rescheduled > 0
          ? `${data.rescheduled}개 항목을 재배치했습니다.`
          : "재배치할 놓친 일정이 없습니다."
      );
    } catch (err) {
      setRescheduleMessage("재배치 중 오류가 발생했습니다: " + err.message);
    } finally {
      setRescheduling(false);
    }
  }

  async function toggleDone(task) {
    setTasks((prev) =>
      prev.map((t) => (t.id === task.id ? { ...t, done: !t.done } : t))
    );
    await fetch("/api/tasks", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: task.id, done: !task.done }),
    });
  }

  if (loading) {
    return <p className="p-8 text-sm text-zinc-500">불러오는 중...</p>;
  }

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-4 px-6 py-12">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-zinc-900">아이젠하워 매트릭스</h1>
        <button
          onClick={handleReschedule}
          disabled={rescheduling}
          className="rounded-full border border-zinc-300 px-4 py-2 text-xs font-medium text-zinc-700 hover:bg-zinc-100 disabled:opacity-50"
        >
          {rescheduling ? "재배치 중..." : "놓친 일정 재배치"}
        </button>
      </div>
      {rescheduleMessage && (
        <p className="text-xs text-zinc-500">{rescheduleMessage}</p>
      )}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {QUADRANTS.map((q) => {
          const items = tasks.filter(
            (t) => t.urgent === q.urgent && t.important === q.important
          );
          return (
            <div
              key={q.key}
              className="flex flex-col gap-2 rounded-lg border border-zinc-200 bg-white p-4"
            >
              <h2 className="text-sm font-semibold text-zinc-700">{q.label}</h2>
              {items.length === 0 && (
                <p className="text-xs text-zinc-400">할 일 없음</p>
              )}
              <ul className="flex flex-col gap-2">
                {items.map((task) => (
                  <li
                    key={task.id}
                    className="flex items-start gap-2 text-sm text-zinc-800"
                  >
                    <input
                      type="checkbox"
                      checked={task.done}
                      onChange={() => toggleDone(task)}
                      className="mt-0.5"
                    />
                    <span className="flex flex-col">
                      <span className={task.done ? "line-through text-zinc-400" : ""}>
                        {task.type === "event" ? "📅 " : ""}
                        {task.title}
                        {task.deadline && (
                          <span className="ml-2 text-xs text-zinc-400">
                            ~{task.deadline}
                          </span>
                        )}
                      </span>
                      {formatScheduled(task) && (
                        <span className="text-xs text-emerald-600">
                          {task.type === "event" ? "일정 등록됨" : "할 일 등록됨"}:{" "}
                          {formatScheduled(task)}
                        </span>
                      )}
                      {task.scheduleError && (
                        <span className="text-xs text-red-500">
                          {task.scheduleError}
                        </span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}
