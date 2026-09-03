import { NextResponse } from "next/server";
import { getTasks, updateTask } from "@/lib/store";
import { completeTask, reopenTask } from "@/lib/googleTasks";

export async function GET() {
  return NextResponse.json({ tasks: await getTasks() });
}

export async function PATCH(request) {
  const { id, ...patch } = await request.json();
  if (!id) {
    return NextResponse.json({ error: "id가 필요합니다." }, { status: 400 });
  }

  const tasks = await updateTask(id, patch);

  // 완료 체크 상태를 Google Tasks에도 반영 (실패해도 앱 동작은 막지 않음)
  if (typeof patch.done === "boolean") {
    const task = tasks.find((t) => t.id === id);
    if (task?.googleTaskId) {
      try {
        await (patch.done ? completeTask(task.googleTaskId) : reopenTask(task.googleTaskId));
      } catch {
        // Google Tasks 동기화 실패는 무시 (로컬 상태는 이미 반영됨)
      }
    }
  }

  return NextResponse.json({ tasks });
}
