import { google } from "googleapis";

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
export async function getTask(taskId) {
  const tasks = getClient();
  try {
    const res = await tasks.tasks.get({ tasklist: "@default", task: taskId });
    return res.data.status === "deleted" ? null : res.data;
  } catch (err) {
    if (err.code === 404 || err.code === 410) return null;
    throw err;
  }
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
