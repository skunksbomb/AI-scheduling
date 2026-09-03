import { addDays } from "@/lib/dates";

export function quadrantRank(item) {
  if (item.urgent && item.important) return 0; // 긴급 & 중요
  if (!item.urgent && item.important) return 1; // 중요 & 안 긴급
  if (item.urgent && !item.important) return 2; // 긴급 & 안 중요
  return 3; // 안 긴급 & 안 중요
}

// 날짜별로 이미 배정된(미완료) '할 일' 개수를 센다. 하루 배치 개수 제한에 쓴다.
export function buildDayCounts(existingTasks) {
  const counts = new Map();
  for (const t of existingTasks) {
    if (t.type === "task" && t.scheduledDate && !t.done) {
      counts.set(t.scheduledDate, (counts.get(t.scheduledDate) ?? 0) + 1);
    }
  }
  return counts;
}

// fromDateStr부터 toDateStr(포함)까지 하루씩 훑으면서 dayCounts가 maxPerDay
// 미만인 첫 번째 날짜를 찾는다. 없으면 null.
export function pickDayWithCapacity({ fromDateStr, toDateStr, maxPerDay, dayCounts }) {
  let day = fromDateStr;
  while (day <= toDateStr) {
    const count = dayCounts.get(day) ?? 0;
    if (count < maxPerDay) return day;
    day = addDays(day, 1);
  }
  return null;
}
