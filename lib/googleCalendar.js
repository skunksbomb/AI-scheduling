import { google } from "googleapis";

const TIME_ZONE = "Asia/Seoul";

const DAY_START_MIN = 0;
const DAY_END_MIN = 24 * 60;

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

export async function getFreeBusy(timeMin, timeMax) {
  const calendar = getClient();
  const res = await calendar.freebusy.query({
    timeZone: TIME_ZONE,
    requestBody: { timeMin, timeMax, items: [{ id: "primary" }] },
  });
  return res.data.calendars.primary.busy ?? [];
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

export async function deleteEvent(eventId) {
  const calendar = getClient();
  try {
    await calendar.events.delete({ calendarId: "primary", eventId });
  } catch (err) {
    // 이미 지워졌거나 없는 이벤트면 무시하고 넘어간다.
    if (err.code !== 404 && err.code !== 410) throw err;
  }
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

// dateStr(YYYY-MM-DD) 하루 안에서 이미 busy인 구간을 분 단위 [start,end] 배열로 반환.
export async function getBusyMinutesForDay(dateStr) {
  const timeMin = `${dateStr}T00:00:00+09:00`;
  const timeMax = `${dateStr}T23:59:59+09:00`;
  const busy = await getFreeBusy(timeMin, timeMax);

  return busy.map((b) => {
    const start = new Date(b.start);
    const end = new Date(b.end);
    const toMin = (d) => d.getHours() * 60 + d.getMinutes();
    return { start: toMin(start), end: toMin(end) };
  });
}

// busyIntervals(분 단위, 정렬 여부 상관없음) 안에서 durationMin 이상 들어갈
// 첫 번째 빈 구간을 찾아 [start,end]를 분 단위로 반환. 없으면 null.
export function findFreeSlot(busyIntervals, durationMin) {
  const sorted = [...busyIntervals].sort((a, b) => a.start - b.start);
  let cursor = DAY_START_MIN;

  for (const interval of sorted) {
    if (interval.start - cursor >= durationMin) {
      return { start: cursor, end: cursor + durationMin };
    }
    cursor = Math.max(cursor, interval.end);
  }

  if (DAY_END_MIN - cursor >= durationMin) {
    return { start: cursor, end: cursor + durationMin };
  }
  return null;
}
