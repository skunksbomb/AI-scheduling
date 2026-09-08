// Date 객체의 로컬 게터로 "YYYY-MM-DD" 문자열을 만든다. 순수 달력 계산에만
// 쓸 것 — 서버의 "지금"이 필요하면 이 함수가 아니라 todayStr()/nowMinutesKST()를
// 쓴다 (서버가 실제로 어느 타임존에서 도는지와 무관하게 KST를 강제하기 위해).
export function toDateStr(d) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

// Date.now()에 KST 오프셋을 더한 뒤 UTC 게터로 읽으면, 서버가 실제로 어느
// 타임존에서 실행되든(Vercel은 UTC) 항상 한국 시간 기준 지금을 얻는다.
// 한국은 서머타임이 없어 고정 오프셋으로 충분하다.
function kstPartsNow() {
  const kst = new Date(Date.now() + KST_OFFSET_MS);
  return {
    year: kst.getUTCFullYear(),
    month: kst.getUTCMonth() + 1,
    date: kst.getUTCDate(),
    hours: kst.getUTCHours(),
    minutes: kst.getUTCMinutes(),
  };
}

export function todayStr() {
  const { year, month, date } = kstPartsNow();
  return `${year}-${String(month).padStart(2, "0")}-${String(date).padStart(2, "0")}`;
}

// "오늘 자정부터 지금까지 몇 분 지났는지"를 KST 기준으로 구한다. 지난 시각으로
// 배치되는 걸 막는 가드레일(lib/placement.js)에서 쓴다.
export function nowMinutesKST() {
  const { hours, minutes } = kstPartsNow();
  return hours * 60 + minutes;
}

export function addDays(dateStr, days) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  return toDateStr(dt);
}

export function toLocalDateTime(dateStr, minutesFromMidnight) {
  const hh = String(Math.floor(minutesFromMidnight / 60)).padStart(2, "0");
  const mm = String(minutesFromMidnight % 60).padStart(2, "0");
  return `${dateStr}T${hh}:${mm}:00`;
}

const KOREAN_WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

// "2026-09-13" -> "9월 13일(일)". 날짜 형식이 아닌 값(null, undefined, 깨진
// 문자열)이 들어오면 "undefined월 undefined일" 같은 문구가 화면에 그대로
// 나가지 않도록 안전한 문구로 대체한다 — 어떤 호출처에서든 마지막 방어선.
export function formatKoreanDate(dateStr) {
  const match = typeof dateStr === "string" ? dateStr.match(/^(\d{4})-(\d{2})-(\d{2})/) : null;
  if (!match) return "날짜 미정";
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  const weekday = KOREAN_WEEKDAYS[new Date(y, m - 1, d).getDay()];
  return `${m}월 ${d}일(${weekday})`;
}

// 자정으로부터의 분 -> "15:00"
export function formatMinutesAsTime(minutesFromMidnight) {
  const hh = String(Math.floor(minutesFromMidnight / 60)).padStart(2, "0");
  const mm = String(minutesFromMidnight % 60).padStart(2, "0");
  return `${hh}:${mm}`;
}

// "2026-09-13T15:00" -> { dateStr: "2026-09-13", minutes: 900 }
export function parseStartTime(startTime) {
  const match = String(startTime).match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/);
  if (!match) return null;
  const [, dateStr, hh, mm] = match;
  return { dateStr, minutes: Number(hh) * 60 + Number(mm) };
}
