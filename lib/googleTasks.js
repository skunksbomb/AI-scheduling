import { google } from "googleapis";
import { addDays } from "@/lib/dates";

function getClient() {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN } = process.env;

  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REFRESH_TOKEN) {
    throw new Error(
      "Google 인증 정보가 없습니다. .env.local의 GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REFRESH_TOKEN을 확인하세요."
    );
  }

  const oauth2Client = new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET);
  oauth2Client.setCredentials({ refresh_token: GOOGLE_REFRESH_TOKEN });
  return google.tasks({ version: "v1", auth: oauth2Client });
}

// dueDateStr: YYYY-MM-DD. Google Tasks는 시간 정보를 쓰지 않고 날짜만 사용한다.
export async function createTask({ title, notes, dueDateStr }) {
  const tasks = getClient();
  const res = await tasks.tasks.insert({
    tasklist: "@default",
    requestBody: {
      title,
      notes,
      due: `${dueDateStr}T00:00:00.000Z`,
    },
  });
  return res.data;
}

// 삭제됐으면 null, 아니면 Google Task 데이터를 반환.
// 주의: Tasks API에서 "삭제됨"은 status가 아니라 별도의 deleted 불리언 필드다
// (status는 needsAction/completed 둘뿐이라 "deleted"라는 값 자체가 없음).
export async function getTask(taskId) {
  const tasks = getClient();
  try {
    const res = await tasks.tasks.get({ tasklist: "@default", task: taskId });
    return res.data.deleted ? null : res.data;
  } catch (err) {
    if (err.code === 404 || err.code === 410) return null;
    throw err;
  }
}

// sinceISO 이후에 생성되거나 수정된 할 일만 반환 (삭제 제외).
// updatedMin은 "수정 시각" 기준이라, 그 시각 이후 새로 생긴 것뿐 아니라
// 오래전에 만든 걸 그 이후에 건드린 것도 걸릴 수 있다 — Tasks API가 생성
// 시각을 따로 안 줘서 나오는 한계.
export async function listTasksUpdatedSince(sinceISO) {
  const tasks = getClient();
  const res = await tasks.tasks.list({
    tasklist: "@default",
    showCompleted: true,
    showHidden: true,
    updatedMin: sinceISO,
  });
  return (res.data.items ?? []).filter((t) => !t.deleted);
}

// dueDateStr(YYYY-MM-DD)이 마감일인 할 일 목록 (완료 포함, 삭제 제외).
// dueMax는 배타적 상한(그 시각 미포함)이라 다음날 자정으로 줘야
// dueDateStr 당일 것까지 포함된다 (같은 날 23:59:59로 주면 하나도 안 걸림).
export async function listTasksDueOn(dueDateStr) {
  const tasks = getClient();
  const res = await tasks.tasks.list({
    tasklist: "@default",
    showCompleted: true,
    showHidden: true,
    dueMin: `${dueDateStr}T00:00:00.000Z`,
    dueMax: `${addDays(dueDateStr, 1)}T00:00:00.000Z`,
  });
  return (res.data.items ?? []).filter((t) => !t.deleted);
}

export async function deleteTask(taskId) {
  const tasks = getClient();
  try {
    await tasks.tasks.delete({ tasklist: "@default", task: taskId });
  } catch (err) {
    if (err.code !== 404 && err.code !== 410) throw err;
  }
}

export async function completeTask(taskId) {
  const tasks = getClient();
  await tasks.tasks.patch({
    tasklist: "@default",
    task: taskId,
    requestBody: { status: "completed" },
  });
}

export async function reopenTask(taskId) {
  const tasks = getClient();
  await tasks.tasks.patch({
    tasklist: "@default",
    task: taskId,
    requestBody: { status: "needsAction" },
  });
}
