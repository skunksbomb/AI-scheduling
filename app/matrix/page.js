"use client";

import { useEffect, useState } from "react";

const QUADRANTS = [
  { key: "do", label: "긴급 & 중요 (즉시 처리)", urgent: true, important: true },
  { key: "schedule", label: "중요 & 안 긴급 (일정 잡기)", urgent: false, important: true },
  { key: "delegate", label: "긴급 & 안 중요 (짧게 처리)", urgent: true, important: false },
  { key: "eliminate", label: "안 긴급 & 안 중요 (나중에)", urgent: false, important: false },
];

export default function MatrixPage() {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);

  async function loadTasks() {
    const res = await fetch("/api/tasks");
    const data = await res.json();
    setTasks(data.tasks || []);
    setLoading(false);
  }

  useEffect(() => {
    loadTasks();
  }, []);

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
      <h1 className="text-xl font-semibold text-zinc-900">아이젠하워 매트릭스</h1>
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
                    <span className={task.done ? "line-through text-zinc-400" : ""}>
                      {task.title}
                      {task.deadline && (
                        <span className="ml-2 text-xs text-zinc-400">
                          ~{task.deadline}
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
