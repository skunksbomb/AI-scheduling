import { getTasks, updateTask, deleteTaskRow } from "@/lib/store";
import { getTask as getGoogleTask } from "@/lib/googleTasks";
import { getEvent as getGoogleEvent } from "@/lib/googleCalendar";

// 앱이 상시 켜져있는 서버가 아니라서 실시간으로 알 방법이 없다.
// 대신 매트릭스 조회 시점마다 Google 쪽 실제 상태를 확인해서
// Supabase를 그 상태에 맞게 맞춘다(직접 지웠으면 지우고, Google Tasks에서
// 완료 체크했으면 done도 반영).
//
// "Google에만 있고 Supabase엔 없는 새 항목 가져오기"는 아직 없음 — 한 번
// 시도했다가 사용자의 기존 Google Tasks 이력 전체(수개월치)를 그대로
// 끌고 들어와버려서 되돌렸다. 언제부터의 항목을 새 항목으로 볼지,
// 분류 기준을 어떻게 정할지 범위를 정한 뒤에 다시 붙일 것.
export async function syncWithGoogle() {
  const tasks = await getTasks();

  for (const task of tasks) {
    if (task.type === "task" && task.googleTaskId) {
      const remote = await getGoogleTask(task.googleTaskId);

      if (!remote) {
        await deleteTaskRow(task.id);
        continue;
      }

      const remoteDone = remote.status === "completed";
      if (remoteDone !== task.done) {
        await updateTask(task.id, { done: remoteDone });
      }
    } else if (task.type === "event" && task.googleEventId) {
      const remote = await getGoogleEvent(task.googleEventId);
      if (!remote) {
        await deleteTaskRow(task.id);
      }
    }
  }

  return getTasks();
}
