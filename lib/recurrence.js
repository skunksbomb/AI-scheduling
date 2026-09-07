import { addDays } from "@/lib/dates";

const VALID_FREQ = new Set(["DAILY", "WEEKLY", "MONTHLY"]);

// Google Calendar 이벤트의 recurrence 배열에 넣을 RRULE 문자열을 만든다.
// 요일(BYDAY)은 일부러 안 받는다 — 시작 날짜(DTSTART)가 이미 그 요일이므로
// AI에게 요일 코드를 따로 계산시키면 틀릴 여지가 생긴다(이 프로젝트의
// "날짜는 AI가 계산하지 않고 표에서 찾는다" 원칙과 같은 이유).
export function buildRecurrenceRule({ freq, untilDateStr }) {
  if (!VALID_FREQ.has(freq)) return null;
  const parts = [`FREQ=${freq}`];
  if (untilDateStr) {
    // UNTIL은 UTC 기준. 하루 뒤 자정(UTC)을 기준으로 잡으면 KST로는 그
    // 다음날 오전 9시라, untilDateStr 당일까지는 항상 포함된다.
    const cutoff = addDays(untilDateStr, 1).replace(/-/g, "");
    parts.push(`UNTIL=${cutoff}T000000Z`);
  }
  return [`RRULE:${parts.join(";")}`];
}
