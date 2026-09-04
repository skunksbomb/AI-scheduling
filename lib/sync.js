import { randomUUID } from "crypto";
import { getTasks, updateTask, deleteTaskRow, addTasks, getAppState, setAppState } from "@/lib/store";
import { getTask as getGoogleTask, listTasksUpdatedSince } from "@/lib/googleTasks";
import { todayStr } from "@/lib/dates";

const LAST_SYNCED_KEY = "lastSyncedAt";

// Supabase의 tasks 테이블은 오직 아이젠하워 매트릭스용이라 '할 일'만 담는다
// ('일정'은 Google Calendar에 바로 생성만 하고 여기엔 안 남김).
//
// 앱이 상시 켜져있는 서버가 아니라서 실시간으로 알 방법이 없다.
// 대신 매트릭스 조회 시점마다 Google Tasks 쪽 실제 상태를 확인해서
// Supabase를 그 상태에 맞게 맞춘다:
// 1) 기존 항목이 Google에서 지워졌으면 Supabase에서도 지움
// 2) Google Tasks에서 직접 완료 체크했으면 done도 반영
// 3) 마지막 동기화 이후 Google Tasks에 새로 생긴 할 일을 가져옴
//    (예전에 "전체 이력을 다 가져오는" 버전을 만들었다가 수개월치 과거
//    할 일이 다 딸려와서 되돌린 적 있음 — 그래서 시각 기준을 반드시 둔다)
export async function syncWithGoogle() {
  const tasks = await getTasks();

  for (const task of tasks) {
    if (!task.googleTaskId) continue;

    const remote = await getGoogleTask(task.googleTaskId);

    if (!remote) {
      await deleteTaskRow(task.id);
      continue;
    }

    const remoteDone = remote.status === "completed";
    if (remoteDone !== task.done) {
      await updateTask(task.id, { done: remoteDone });
    }
  }

  await importNewGoogleTasks(await getTasks());

  return getTasks();
}

async function importNewGoogleTasks(knownTasks) {
  const now = new Date().toISOString();
  const lastSyncedAt = await getAppState(LAST_SYNCED_KEY);

  // 처음 동기화하는 거면 지금 시각을 기준점으로만 남기고, 이번엔 아무것도
  // 가져오지 않는다 (기준 없이 가져오면 예전 이력이 전부 딸려옴).
  if (!lastSyncedAt) {
    await setAppState(LAST_SYNCED_KEY, now);
    return;
  }

  const knownIds = new Set(knownTasks.map((t) => t.googleTaskId).filter(Boolean));
  const remoteTasks = await listTasksUpdatedSince(lastSyncedAt);
  const newOnes = remoteTasks.filter((rt) => !knownIds.has(rt.id));

  if (newOnes.length > 0) {
    // 아이젠하워 분류 기준이 아직 정해지지 않아서, 기준 나올 때까지 임시로
    // "중요 & 안 긴급" 칸에 넣어둔다.
    const imported = newOnes.map((rt) => ({
      id: randomUUID(),
      type: "task",
      title: rt.title || "(제목 없음)",
      deadline: null,
      urgent: false,
      important: true,
      estimatedMinutes: 60,
      done: rt.status === "completed",
      rawText: "(Google Tasks에서 직접 추가됨)",
      createdAt: new Date().toISOString(),
      deadlineEventId: null,
      scheduledDate: rt.due ? rt.due.slice(0, 10) : todayStr(),
      googleTaskId: rt.id,
      scheduleError: null,
    }));

    await addTasks(imported);
  }

  await setAppState(LAST_SYNCED_KEY, now);
}
