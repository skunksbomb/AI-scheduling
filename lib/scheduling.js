import { createEvent, getBusyMinutesForDay, findFreeSlot } from "@/lib/googleCalendar";
import { todayStr, addDays, toLocalDateTime } from "@/lib/dates";

export function quadrantRank(item) {
  if (item.urgent && item.important) return 0; // 긴급 & 중요
  if (!item.urgent && item.important) return 1; // 중요 & 안 긴급
  if (item.urgent && !item.important) return 2; // 긴급 & 안 중요
  return 3; // 안 긴급 & 안 중요
}

// dateStr별 busy 구간을 요청 한 번만 조회해서 캐싱하고, 오늘 날짜는
// 자정~현재 시각까지를 busy로 미리 막아서 과거 시각에 배치되지 않게 한다.
// 같은 캐시 인스턴스 안에서 push한 구간은 이후 조회에도 계속 반영된다.
export function createDayBusyCache() {
  const cache = new Map();

  async function getBusyForDay(dateStr) {
    if (!cache.has(dateStr)) {
      const busy = await getBusyMinutesForDay(dateStr);

      if (dateStr === todayStr()) {
        const now = new Date();
        const nowMinutes = now.getHours() * 60 + now.getMinutes();
        const roundedNow = Math.ceil(nowMinutes / 15) * 15;
        busy.push({ start: 0, end: roundedNow });
      }

      cache.set(dateStr, busy);
    }
    return cache.get(dateStr);
  }

  return { getBusyForDay };
}

// fromDateStr부터 toDateStr(포함)까지 하루씩 훑으면서 가장 빠른 빈 시간에
// 이벤트를 만든다. 찾으면 배치 결과를, 못 찾으면 null을 반환한다.
export async function placeInEarliestSlot({
  title,
  estimatedMinutes,
  fromDateStr,
  toDateStr,
  getBusyForDay,
}) {
  let day = fromDateStr;

  while (day <= toDateStr) {
    const busy = await getBusyForDay(day);
    const slot = findFreeSlot(busy, estimatedMinutes);

    if (slot) {
      const startISO = toLocalDateTime(day, slot.start);
      const endISO = toLocalDateTime(day, slot.end);
      const event = await createEvent({ title, startISO, endISO });
      busy.push(slot);
      return { scheduledStart: startISO, scheduledEnd: endISO, googleEventId: event.id };
    }

    day = addDays(day, 1);
  }

  return null;
}
