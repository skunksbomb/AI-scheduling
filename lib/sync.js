import { randomUUID } from "crypto";
import { getTasks, updateTask, deleteTaskRow, addTasks, getAppState, setAppState } from "@/lib/store";
import { getTask as getGoogleTask, listTasksUpdatedSince } from "@/lib/googleTasks";
import { getEvent as getGoogleEvent } from "@/lib/googleCalendar";
import { todayStr } from "@/lib/dates";

const LAST_SYNCED_KEY = "lastSyncedAt";

// Supabase의 tasks 테이블은 오직 아이젠하워 매트릭스용이라 '할 일'만 담는다
// ('일정'은 Google Calendar에 바로 생성만 하고 여기엔 안 남김).
//
// 앱이 상시 켜져있는 서버가 아니라서 실시간으로 알 방법이 없다.
// 대신 매트릭스 조회 시점마다 Google Tasks 쪽 실제 상태를 확인해서
// Supabase를 그 상태에 맞게 맞춘다:
// '할 일'(Google Task, 실제 작업)과 '마감 표시'(Calendar 이벤트, 🔔)는 서로 독립된
// 트래킹이다 — 하나가 지워졌다고 해서 다른 하나까지 같이 지워지면 안 된다:
// 1) 할 일이 Google에서 지워졌으면: 할 일 관련 필드만 정리. 마감 표시가 아직
//    살아있으면 그건 그대로 두고(=다가오는 마감에 계속 남음) row 자체는 안 지운다.
// 2) 마감 표시 이벤트가 캘린더에서 지워졌으면: deadline을 지운다(=다가오는
//    마감에서 사라짐). 할 일 자체는 그대로 둔다.
// 3) 둘 다 없으면(원래 없었거나 방금 지워졌으면) 그제서야 row를 완전히 지운다.
// 4) Google Tasks에서 직접 완료 체크했으면 done도 반영.
// 5) 마지막 동기화 이후 Google Tasks에 새로 생긴 할 일을 가져옴
//    (예전에 "전체 이력을 다 가져오는" 버전을 만들었다가 수개월치 과거
//    할 일이 다 딸려와서 되돌린 적 있음 — 그래서 시각 기준을 반드시 둔다)
export async function syncWithGoogle() {
  const tasks = await getTasks();

  for (const task of tasks) {
    let googleTaskId = task.googleTaskId;
    let deadlineEventId = task.deadlineEventId;

    if (task.googleTaskId) {
      const remote = await getGoogleTask(task.googleTaskId);

      if (!remote) {
        googleTaskId = null;
      } else {
        const remoteDone = remote.status === "completed";
        if (remoteDone !== task.done) {
          await updateTask(task.id, { done: remoteDone });
        }
      }
    }

    if (task.deadlineEventId) {
      const remoteEvent = await getGoogleEvent(task.deadlineEventId);
      if (!remoteEvent) {
        deadlineEventId = null;
      }
    }

    // 최종 상태 기준으로 판단한다 — 이번 판에 막 지워졌든, 이전 판에 이미
    // 지워져서 필드가 비어있었든 상관없이 "할 일도 마감도 둘 다 없으면" 지운다.
    if (!googleTaskId && !deadlineEventId) {
      await deleteTaskRow(task.id);
      continue;
    }

    const patch = {};
    if (googleTaskId !== task.googleTaskId) {
      patch.googleTaskId = null;
      patch.scheduledDate = null;
      patch.suggestedStartMinutes = null;
      patch.suggestedEndMinutes = null;
    }
    if (deadlineEventId !== task.deadlineEventId) {
      patch.deadline = null;
      patch.deadlineEventId = null;
    }
    if (Object.keys(patch).length > 0) {
      await updateTask(task.id, patch);
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
      exact: false,
      urgent: false,
      important: true,
      estimatedMinutes: 60,
      done: rt.status === "completed",
      rawText: "(Google Tasks에서 직접 추가됨)",
      createdAt: new Date().toISOString(),
      deadlineEventId: null,
      scheduledDate: rt.due ? rt.due.slice(0, 10) : todayStr(),
      suggestedStartMinutes: null,
      suggestedEndMinutes: null,
      googleTaskId: rt.id,
      scheduleError: null,
    }));

    await addTasks(imported);
  }

  await setAppState(LAST_SYNCED_KEY, now);
}
