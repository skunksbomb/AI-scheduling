"use client";

import { useState } from "react";
import { apiFetch } from "@/lib/clientFetch";
import { useTaskDone } from "@/lib/taskDoneContext";

export default function TodayTaskList({ initialTasks }) {
  const [tasks, setTasks] = useState(initialTasks);
  const { setDone } = useTaskDone();

  async function toggle(task) {
    const done = task.status !== "completed";
    setTasks((prev) =>
      prev.map((t) => (t.id === task.id ? { ...t, status: done ? "completed" : "needsAction" } : t))
    );
    setDone(task.id, done);
    try {
      await apiFetch("/api/today-tasks", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: task.id, done }),
      });
    } catch {
      // 실패하면 원래 상태로 되돌린다.
      setTasks((prev) =>
        prev.map((t) => (t.id === task.id ? { ...t, status: task.status } : t))
      );
      setDone(task.id, task.status === "completed");
    }
  }

  return (
    <ul className="flex flex-col divide-y divide-zinc-200 rounded-lg border border-zinc-200 bg-white">
      {tasks.map((task) => {
        const done = task.status === "completed";
        return (
          <li key={task.id} className="flex items-center gap-3 px-4 py-3 text-sm">
            <span className="w-20 shrink-0 text-xs text-zinc-500">할 일</span>
            <label className="flex flex-1 items-center gap-2">
              <input type="checkbox" checked={done} onChange={() => toggle(task)} />
              <span className={done ? "text-zinc-400 line-through" : "text-zinc-800"}>{task.title}</span>
            </label>
          </li>
        );
      })}
    </ul>
  );
}
