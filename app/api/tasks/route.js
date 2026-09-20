import { NextResponse } from "next/server";
import { getTasks, updateTask, deleteTaskRow } from "@/lib/store";
import { completeTask, reopenTask, deleteTask as deleteGoogleTask } from "@/lib/googleTasks";
import { syncIfStale, syncWithGoogle } from "@/lib/sync";
import { getCurrentUser } from "@/lib/auth";
import { apiErrorResponse } from "@/lib/apiError";

const SYNC_MAX_AGE_MINUTES = 30;

export async function GET(request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  // 평소엔 마지막 동기화가 오래됐을 때만 구글을 본다(매번 보면 매트릭스 진입이
  // 느려짐). 구글 캘린더/할일에서 직접 고친 걸 지금 당장 확인하고 싶을 때만
  // 매트릭스의 "지금 동기화" 버튼이 ?force=1로 이 제한을 건너뛴다.
  const force = new URL(request.url).searchParams.get("force") === "1";

  try {
    const tasks = force
      ? await syncWithGoogle(user.id, user.refreshToken)
      : await syncIfStale(user.id, user.refreshToken, SYNC_MAX_AGE_MINUTES);
    return NextResponse.json({ tasks });
  } catch (err) {
    return apiErrorResponse(err);
  }
}

export async function DELETE(request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const id = new URL(request.url).searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "id가 필요합니다." }, { status: 400 });
  }

  try {
    const task = (await getTasks(user.id)).find((t) => t.id === id);
    if (!task) {
      return NextResponse.json({ error: "해당 할 일을 찾을 수 없습니다." }, { status: 404 });
    }

    // 할 일(Google Task)만 지운다. 마감 표시(🔔) 캘린더 이벤트는 일부러 남긴다 —
    // 할 일을 지웠다고 마감 추적까지 사라지면 안 되기 때문. 마감을 없애려면
    // 캘린더에서 그 이벤트를 직접 지우면 되고, 그러면 "다가오는 마감"에서도 사라진다.
    if (task.googleTaskId) await deleteGoogleTask(user.refreshToken, task.googleTaskId);
    await deleteTaskRow(user.id, id);

    return NextResponse.json({ tasks: await getTasks(user.id) });
  } catch (err) {
    return apiErrorResponse(err);
  }
}

export async function PATCH(request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const { id, ...patch } = await request.json();
  if (!id) {
    return NextResponse.json({ error: "id가 필요합니다." }, { status: 400 });
  }

  try {
    const tasks = await updateTask(user.id, id, patch);

    // 완료 체크 상태를 Google Tasks에도 반영 (실패해도 앱 동작은 막지 않음)
    if (typeof patch.done === "boolean") {
      const task = tasks.find((t) => t.id === id);
      if (task?.googleTaskId) {
        try {
          await (patch.done ? completeTask(user.refreshToken, task.googleTaskId) : reopenTask(user.refreshToken, task.googleTaskId));
        } catch {
          // Google Tasks 동기화 실패는 무시 (로컬 상태는 이미 반영됨)
        }
      }
    }

    return NextResponse.json({ tasks });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
