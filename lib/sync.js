import { randomUUID } from "crypto";
import { getTasks, updateTask, deleteTaskRow, addTasks, getAppState, setAppState } from "@/lib/store";
import { listAllTasks, listTasksUpdatedSince } from "@/lib/googleTasks";
import { listEvents } from "@/lib/googleCalendar";
import { todayStr, addDays } from "@/lib/dates";

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
// 예전엔 할 일 하나하나마다 구글에 "이거 아직 있어?"를 순서대로 물어봤다
// (할 일 N개 = 최대 2N번의 순차 API 호출 -> 개수가 늘수록 매트릭스 로딩이
// 선형으로 느려짐). 대신 구글 Tasks 전체 목록 / 관련 기간의 캘린더 이벤트
// 목록을 딱 한 번씩만 받아와서, 존재 여부를 메모리에서 대조한다.
export async function syncWithGoogle(userId, refreshToken) {
  const tasks = await getTasks(userId);
  if (tasks.length === 0) {
    await importNewGoogleTasks(userId, refreshToken, tasks);
    return getTasks(userId);
  }

  const needsTaskList = tasks.some((t) => t.googleTaskId);
  const deadlineDates = tasks
    .filter((t) => t.deadlineEventId)
    .map((t) => t.deadline)
    .filter(Boolean);

  const [remoteTasks, remoteEvents] = await Promise.all([
    needsTaskList ? listAllTasks(refreshToken) : Promise.resolve([]),
    deadlineDates.length > 0 ? listDeadlineEventsCovering(refreshToken, deadlineDates) : Promise.resolve([]),
  ]);

  const remoteTaskById = new Map(remoteTasks.map((t) => [t.id, t]));
  const liveEventIds = new Set(remoteEvents.map((e) => e.id));

  for (const task of tasks) {
    let googleTaskId = task.googleTaskId;
    let deadlineEventId = task.deadlineEventId;

    if (task.googleTaskId) {
      const remote = remoteTaskById.get(task.googleTaskId);

      if (!remote) {
        googleTaskId = null;
      } else {
        const remoteDone = remote.status === "completed";
        if (remoteDone !== task.done) {
          await updateTask(userId, task.id, { done: remoteDone });
        }
      }
    }

    if (task.deadlineEventId && !liveEventIds.has(task.deadlineEventId)) {
      deadlineEventId = null;
    }

    // 최종 상태 기준으로 판단한다 — 이번 판에 막 지워졌든, 이전 판에 이미
    // 지워져서 필드가 비어있었든 상관없이 "할 일도 마감도 둘 다 없으면" 지운다.
    if (!googleTaskId && !deadlineEventId) {
      await deleteTaskRow(userId, task.id);
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
      await updateTask(userId, task.id, patch);
    }
  }

  await importNewGoogleTasks(userId, refreshToken, await getTasks(userId));

  return getTasks(userId);
}

// 마감 표시 이벤트는 전부 dateStr ~ dateStr+1일짜리 하루종일 이벤트라
// (taskCommit.js의 createAllDayEvent 참고), 알고 있는 마감일들의 최소~최대
// 범위를 하루씩 여유 있게 잡아 한 번의 목록 조회로 다 덮는다.
async function listDeadlineEventsCovering(refreshToken, deadlineDates) {
  const sorted = [...deadlineDates].sort();
  const timeMin = `${addDays(sorted[0], -1)}T00:00:00Z`;
  const timeMax = `${addDays(sorted[sorted.length - 1], 2)}T00:00:00Z`;
  return listEvents(refreshToken, timeMin, timeMax);
}

async function importNewGoogleTasks(userId, refreshToken, knownTasks) {
  const now = new Date().toISOString();
  const lastSyncedAt = await getAppState(userId, LAST_SYNCED_KEY);

  // 처음 동기화하는 거면 지금 시각을 기준점으로만 남기고, 이번엔 아무것도
  // 가져오지 않는다 (기준 없이 가져오면 예전 이력이 전부 딸려옴).
  if (!lastSyncedAt) {
    await setAppState(userId, LAST_SYNCED_KEY, now);
    return;
  }

  const knownIds = new Set(knownTasks.map((t) => t.googleTaskId).filter(Boolean));
  const remoteTasks = await listTasksUpdatedSince(refreshToken, lastSyncedAt);
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

    await addTasks(userId, imported);
  }

  await setAppState(userId, LAST_SYNCED_KEY, now);
}
