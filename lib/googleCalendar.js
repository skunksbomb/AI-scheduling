import { google } from "googleapis";

const TIME_ZONE = "Asia/Seoul";

function getClient(refreshToken) {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } = process.env;

  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !refreshToken) {
    throw new Error(
      "Google Calendar 인증 정보가 없습니다. .env.local의 GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET을 확인하거나, 다시 로그인해주세요."
    );
  }

  const oauth2Client = new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET);
  oauth2Client.setCredentials({ refresh_token: refreshToken });
  return google.calendar({ version: "v3", auth: oauth2Client });
}

// timeMin, timeMax: ISO 문자열
export async function listEvents(refreshToken, timeMin, timeMax) {
  const calendar = getClient(refreshToken);
  const res = await calendar.events.list({
    calendarId: "primary",
    timeMin,
    timeMax,
    singleEvents: true,
    orderBy: "startTime",
  });
  return res.data.items ?? [];
}

export async function createEvent(refreshToken, { title, startISO, endISO, description, recurrence }) {
  const calendar = getClient(refreshToken);
  const res = await calendar.events.insert({
    calendarId: "primary",
    requestBody: {
      summary: title,
      description,
      start: { dateTime: startISO, timeZone: TIME_ZONE },
      end: { dateTime: endISO, timeZone: TIME_ZONE },
      ...(recurrence ? { recurrence } : {}),
    },
  });
  return res.data;
}

export async function createAllDayEvent(refreshToken, { title, dateStr, nextDateStr, recurrence }) {
  const calendar = getClient(refreshToken);
  const res = await calendar.events.insert({
    calendarId: "primary",
    requestBody: {
      summary: title,
      start: { date: dateStr },
      end: { date: nextDateStr },
      ...(recurrence ? { recurrence } : {}),
    },
  });
  return res.data;
}

// 삭제됐으면 null, 아니면 이벤트 데이터를 반환. Calendar API는 삭제된 이벤트를
// status: "cancelled"로 표시한다 (Tasks API의 별도 deleted 필드와는 다름).
export async function getEvent(refreshToken, eventId) {
  const calendar = getClient(refreshToken);
  try {
    const res = await calendar.events.get({ calendarId: "primary", eventId });
    return res.data.status === "cancelled" ? null : res.data;
  } catch (err) {
    if (err.code === 404 || err.code === 410) return null;
    throw err;
  }
}

// title/startISO+endISO(시간 있는 일정) 또는 title/dateStr+nextDateStr(하루종일)
// 중 필요한 것만 넘기면 된다 — 넘긴 필드만 바뀌고 나머진 그대로 유지된다.
export async function updateEvent(refreshToken, eventId, { title, startISO, endISO, dateStr, nextDateStr }) {
  const calendar = getClient(refreshToken);
  const requestBody = {};
  if (title != null) requestBody.summary = title;
  if (startISO && endISO) {
    requestBody.start = { dateTime: startISO, timeZone: TIME_ZONE };
    requestBody.end = { dateTime: endISO, timeZone: TIME_ZONE };
  } else if (dateStr && nextDateStr) {
    requestBody.start = { date: dateStr };
    requestBody.end = { date: nextDateStr };
  }
  const res = await calendar.events.patch({ calendarId: "primary", eventId, requestBody });
  return res.data;
}

export async function deleteEvent(refreshToken, eventId) {
  const calendar = getClient(refreshToken);
  try {
    await calendar.events.delete({ calendarId: "primary", eventId });
  } catch (err) {
    if (err.code !== 404 && err.code !== 410) throw err;
  }
}
