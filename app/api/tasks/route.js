import { NextResponse } from "next/server";
import { getTasks, updateTask, deleteTaskRow } from "@/lib/store";
import { completeTask, reopenTask, deleteTask as deleteGoogleTask } from "@/lib/googleTasks";
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

  // 할 일(Google Task)만 지운다. 마감 표시(🔔) 캘린더 이벤트는 일부러 남긴다 —
  // 할 일을 지웠다고 마감 추적까지 사라지면 안 되기 때문. 마감을 없애려면
  // 캘린더에서 그 이벤트를 직접 지우면 되고, 그러면 "다가오는 마감"에서도 사라진다.
  if (task.googleTaskId) await deleteGoogleTask(task.googleTaskId);
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
