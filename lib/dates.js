// Date.toISOString()은 UTC 기준이라 한국 시간(KST, UTC+9) 새벽 0~9시에는
// 하루 전 날짜로 잘못 계산된다. 로컬 시간 기준으로 날짜 문자열을 만든다.
export function toDateStr(d) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export function todayStr() {
  return toDateStr(new Date());
}

export function addDays(dateStr, days) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  return toDateStr(dt);
}
