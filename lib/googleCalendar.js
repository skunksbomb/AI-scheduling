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

export async function deleteEvent(eventId) {
  const calendar = getClient();
  try {
    await calendar.events.delete({ calendarId: "primary", eventId });
  } catch (err) {
    if (err.code !== 404 && err.code !== 410) throw err;
  }
}
