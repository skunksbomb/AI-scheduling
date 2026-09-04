import { google } from "googleapis";

const TIME_ZONE = "Asia/Seoul";

function getClient() {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN } = process.env;

  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REFRESH_TOKEN) {
    throw new Error(
      "Google Calendar 인증 정보가 없습니다. .env.local의 GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REFRESH_TOKEN을 확인하세요."
    );
  }

  const oauth2Client = new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET);
  oauth2Client.setCredentials({ refresh_token: GOOGLE_REFRESH_TOKEN });
  return google.calendar({ version: "v3", auth: oauth2Client });
}

// timeMin, timeMax: ISO 문자열
export async function listEvents(timeMin, timeMax) {
  const calendar = getClient();
  const res = await calendar.events.list({
    calendarId: "primary",
    timeMin,
    timeMax,
    singleEvents: true,
    orderBy: "startTime",
  });
  return res.data.items ?? [];
}

export async function createEvent({ title, startISO, endISO, description }) {
  const calendar = getClient();
  const res = await calendar.events.insert({
    calendarId: "primary",
    requestBody: {
      summary: title,
      description,
      start: { dateTime: startISO, timeZone: TIME_ZONE },
      end: { dateTime: endISO, timeZone: TIME_ZONE },
    },
  });
  return res.data;
}

export async function createAllDayEvent({ title, dateStr, nextDateStr }) {
  const calendar = getClient();
  const res = await calendar.events.insert({
    calendarId: "primary",
    requestBody: {
      summary: title,
      start: { date: dateStr },
      end: { date: nextDateStr },
    },
  });
  return res.data;
}

// 삭제됐으면 null, 아니면 이벤트 데이터를 반환. Calendar API는 삭제된 이벤트를
// status: "cancelled"로 표시한다 (Tasks API의 별도 deleted 필드와는 다름).
export async function getEvent(eventId) {
  const calendar = getClient();
  try {
    const res = await calendar.events.get({ calendarId: "primary", eventId });
    return res.data.status === "cancelled" ? null : res.data;
  } catch (err) {
    if (err.code === 404 || err.code === 410) return null;
    throw err;
  }
}

export async function deleteEvent(eventId) {
  const calendar = getClient();
  try {
    await calendar.events.delete({ calendarId: "primary", eventId });
  } catch (err) {
    if (err.code !== 404 && err.code !== 410) throw err;
  }
}
