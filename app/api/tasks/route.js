import { NextResponse } from "next/server";
import { getTasks, updateTask, deleteTaskRow } from "@/lib/store";
import { completeTask, reopenTask, deleteTask as deleteGoogleTask } from "@/lib/googleTasks";
import { deleteEvent } from "@/lib/googleCalendar";
import { syncWithGoogle } from "@/lib/sync";

export async function GET() {
  return NextResponse.json({ tasks: await syncWithGoogle() });
}

export async function DELETE(request) {
  const id = new URL(request.url).searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "id가 필요합니다." }, { status: 400 });
  }

  const task = (await getTasks()).find((t) => t.id === id);
  if (!task) {
    return NextResponse.json({ error: "해당 할 일을 찾을 수 없습니다." }, { status: 404 });
  }

  if (task.googleTaskId) await deleteGoogleTask(task.googleTaskId);
  if (task.deadlineEventId) await deleteEvent(task.deadlineEventId);
  await deleteTaskRow(id);

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
