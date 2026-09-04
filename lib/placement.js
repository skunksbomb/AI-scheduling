import OpenAI from "openai";
import { buildDateTable } from "@/lib/ai";
import { quadrantRank, buildDayCounts, pickDayWithCapacity } from "@/lib/scheduling";
import { todayStr, addDays, toDateStr, formatKoreanDate, formatMinutesAsTime, parseStartTime } from "@/lib/dates";
import { listEvents } from "@/lib/googleCalendar";
import { getTasks } from "@/lib/store";

const FALLBACK_WINDOW_DAYS = 14;
// AI 배치 제안이 실패했을 때만 쓰는 예전 방식의 상한선.
const FALLBACK_MAX_TASKS_PER_DAY = 4;

// gpt-4o-mini는 구조화된 정보 추출(파싱)엔 충분하지만, 이건 실제 캘린더를 보고
// "언제가 좋을지" 판단하는 작업이라 상위 모델을 쓴다. dump 1번당 1회 호출이라
// 비용 부담은 적다. 모델을 바꾸고 싶으면 이 환경변수만 바꾸면 된다.
const PLACEMENT_MODEL = process.env.OPENAI_PLACEMENT_MODEL || "gpt-4o";

function quadrantLabel(item) {
  if (item.urgent && item.important) return "긴급&중요 (즉시 처리 — 가장 이른 시일에 배치)";
  if (!item.urgent && item.important)
    return "안긴급&중요 (일정 잡기 — 급하지 않다는 이유로 밀려나기 가장 쉬운 유형이니, 의도적으로 여유롭고 집중 가능한 시간대를 확보해서 배치)";
  if (item.urgent && !item.important) return "긴급&안중요 (짧게 처리 — 빠르되 짧고 부담 적은 시간대)";
  return "안긴급&안중요 (나중에 — 급하지 않으니 뒤쪽 날짜로 밀어도 됨)";
}

function dateTimeToDateAndMinutes(iso) {
  const d = new Date(iso);
  return { dateStr: toDateStr(d), minutes: d.getHours() * 60 + d.getMinutes() };
}

function daysBetween(fromStr, toStr) {
  const [fy, fm, fd] = fromStr.split("-").map(Number);
  const [ty, tm, td] = toStr.split("-").map(Number);
  return Math.round((new Date(ty, tm - 1, td) - new Date(fy, fm - 1, fd)) / (24 * 60 * 60 * 1000));
}

function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}

// 실제 캘린더 이벤트를 날짜별 [시작분, 끝분] 목록으로 묶는다.
function groupBusyEventsByDate(busyEvents) {
  const byDate = new Map();
  for (const e of busyEvents) {
    if (!e.start?.dateTime || !e.end?.dateTime) continue;
    const start = dateTimeToDateAndMinutes(e.start.dateTime);
    const end = dateTimeToDateAndMinutes(e.end.dateTime);
    if (!byDate.has(start.dateStr)) byDate.set(start.dateStr, []);
    byDate.get(start.dateStr).push([start.minutes, end.minutes]);
  }
  return byDate;
}

// 특정 날짜/시간대가 실제 캘린더 이벤트와 겹치는지 확인. 겹치면 true.
export function findTimeConflict(dateStr, startMinutes, endMinutes, busyEvents) {
  const byDate = groupBusyEventsByDate(busyEvents);
  const dayBusy = byDate.get(dateStr) ?? [];
  return dayBusy.some(([s, e]) => overlaps(startMinutes, endMinutes, s, e));
}

function buildBusyEventLines(busyEvents) {
  return busyEvents
    .filter((e) => e.start?.dateTime && e.end?.dateTime)
    .map((e) => {
      const start = dateTimeToDateAndMinutes(e.start.dateTime);
      const end = dateTimeToDateAndMinutes(e.end.dateTime);
      return `${start.dateStr} ${formatMinutesAsTime(start.minutes)}~${formatMinutesAsTime(end.minutes)} "${
        e.summary ?? "(제목 없음)"
      }"`;
    });
}

function buildBusyTaskLines(busyTasks) {
  return busyTasks.map((t) =>
    t.suggestedStartMinutes != null && t.suggestedEndMinutes != null
      ? `${t.scheduledDate} ${formatMinutesAsTime(t.suggestedStartMinutes)}~${formatMinutesAsTime(
          t.suggestedEndMinutes
        )} "${t.title}" (다른 할일)`
      : `${t.scheduledDate} 시간 미정 "${t.title}" (다른 할일)`
  );
}

// AI에게 실제 캘린더 컨텍스트를 주고 각 할일을 언제(그리고 필요하면 몇 시에) 배치할지
// 제안받는다. 부작용 없음 — Google/Supabase에 아무것도 쓰지 않는다.
export async function suggestPlacements({ items, busyEvents, busyTasks, windowTo, userContext = [], latestFeedback = null }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY가 설정되어 있지 않습니다.");
  }

  const client = new OpenAI({ apiKey });
  const today = todayStr();
  const dayCount = Math.max(7, Math.min(35, daysBetween(today, windowTo) + 3));
  const dateTable = buildDateTable(dayCount);

  const busyLines = [...buildBusyEventLines(busyEvents), ...buildBusyTaskLines(busyTasks)];
  const busyBlock = busyLines.length > 0 ? busyLines.join("\n") : "(현재 기간 내 등록된 일정 없음)";

  const contextBlock =
    userContext.length > 0 ? userContext.map((line) => `- ${line}`).join("\n") : "(등록된 개인 컨텍스트 없음)";

  const itemLines = items
    .map((item, index) => {
      const dateInfo = item.exact && item.deadline
        ? `날짜 고정: ${item.deadline} (반드시 이 날짜로)`
        : item.deadline
          ? `마감: ${item.deadline} (오늘부터 이 날짜 사이 아무 날에나 배치 가능)`
          : "마감 없음 (특별히 미룰 이유가 없으면 오늘이나 내일처럼 가까운 날로. 이유 없이 며칠씩 미루지 말 것)";
      return `[${index}] "${item.title}" / ${dateInfo} / ${quadrantLabel(item)} / 예상 소요시간 ${
        item.estimatedMinutes ?? 60
      }분`;
    })
    .join("\n");

  const systemPrompt = `당신은 사용자의 실제 구글 캘린더 일정과 이미 배치된 다른 할 일을 참고해서,
각 '할 일'을 언제(그리고 필요하다면 몇 시에) 하면 좋을지 판단하는 비서입니다.

날짜/요일 표 (직접 계산하지 말고 반드시 이 표에서 찾아서 쓸 것):
${dateTable}

기존에 이미 잡혀있는 일정/할일 (겹치지 않게 배치할 것):
${busyBlock}

사용자 개인 컨텍스트 (평소 반복되는 상황·선호. 판단에 참고할 것):
${contextBlock}
${
  latestFeedback
    ? `\n사용자가 방금 이 배치에 대해 직접 준 피드백 — 이번 재배치에 반드시, 최우선으로 반영할 것:\n"${latestFeedback}"\n`
    : ""
}
배치할 할 일 목록:
${itemLines}

판단 규칙:
- "날짜 고정"인 항목은 scheduledDate를 반드시 그 날짜 그대로 쓰세요. 시간대만 판단하면 됩니다
  (시간을 정할 필요가 없는 일이면 hasSuggestedTime: false로 날짜만 남겨도 됩니다).
- "마감"이 있는 항목은 오늘부터 그 마감일 사이에서 적절한 날짜를 고르세요.
- "마감 없음"인 항목을 며칠씩 미루지 마세요. 오늘/내일에 배치 못 할 실제 이유(예: 이미 그 시간대가
  다른 일정으로 꽉 차 있음)가 없다면 오늘이나 내일처럼 가장 가까운 날에 배치하세요. "급하지 않으니
  여유를 두자"는 이유만으로 미루는 것은 금지입니다.
- 아이젠하워 사분면에 따라 배치 전략을 다르게 하세요 (위에 항목별로 명시된 전략을 따를 것). 단,
  "안긴급&중요"도 오늘/내일 배치가 가능하면 오늘/내일에 배치하세요 — 여기서 "의도적으로 좋은
  시간대를 확보하라"는 것은 날짜를 늦추라는 뜻이 아니라, 가까운 날 중에서도 짧게 때우지 말고
  충분히 집중할 수 있는 시간대를 골라주라는 뜻입니다.
- 위 "기존에 이미 잡혀있는 일정"과 시간이 겹치지 않게 하세요.
- 모든 항목에 시간을 줄 필요는 없습니다. 언제 해도 상관없는 간단한 일은 hasSuggestedTime: false로
  날짜만 정하고, 시간대가 중요한 일에는 시간을 제안하세요.
- 시간대를 고를 때 새벽 등 비상식적인 시간은 피하세요. 고정된 활동시간표는 따로 주어지지 않으니,
  위 "기존에 이미 잡혀있는 일정"이 언제 몰려 있는지를 보고 사용자의 생활 패턴을 스스로 추론해서
  상식적인 시간을 판단하세요.
- 하루에 몰아넣지 말고 자연스럽게 분산하세요. 정해진 개수 제한은 없습니다.
- estimatedMinutes를 참고해서 시간대 길이를 정하세요.

설명 없이 다음 형식의 JSON 객체 하나만 출력하세요:
{
  "placements": [
    {
      "index": 0,
      "scheduledDate": "YYYY-MM-DD",
      "hasSuggestedTime": true 또는 false,
      "suggestedStartMinutes": 자정 기준 분 단위 정수 또는 null,
      "suggestedEndMinutes": 자정 기준 분 단위 정수 또는 null,
      "reasoning": "한 문장 이유"
    }
  ]
}`;

  const requestBody = {
    model: PLACEMENT_MODEL,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: "위 정보를 바탕으로 배치를 제안해주세요." },
    ],
  };
  // 추론(reasoning) 계열 모델(o1/o3 등)은 커스텀 temperature를 거부하는 경우가 있어 건너뛴다.
  if (!/^o\d/.test(PLACEMENT_MODEL)) {
    requestBody.temperature = 0;
  }

  const completion = await client.chat.completions.create(requestBody);

  const raw = completion.choices[0]?.message?.content;
  if (!raw) {
    throw new Error("배치 제안 응답에서 텍스트를 찾지 못했습니다.");
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("배치 제안 응답을 JSON으로 해석하지 못했습니다: " + raw);
  }

  if (!Array.isArray(parsed.placements)) {
    throw new Error("배치 제안 응답 형식이 올바르지 않습니다 (placements 배열 없음).");
  }

  return parsed.placements;
}

// AI 제안을 결정론적 규칙으로 검증/보정한다. "바보 같은 배치"만 막는 최소한의
// 가드레일 — 몇 시가 적당한지, 어떻게 분산할지는 여기서 코드로 재판단하지 않는다.
export function applyGuardrails({ items, placements, busyEvents }) {
  const today = todayStr();
  const now = new Date();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const placementByIndex = new Map(placements.map((p) => [p.index, p]));

  // 낮은 우선순위가 높은 우선순위에 양보하도록, 우선순위 순서로 처리한다.
  const order = items.map((item, index) => ({ item, index })).sort((a, b) => quadrantRank(a.item) - quadrantRank(b.item));

  const results = new Array(items.length);

  for (const { item, index } of order) {
    const raw = placementByIndex.get(index) ?? {};
    let scheduledDate = raw.scheduledDate;
    let hasSuggestedTime = Boolean(raw.hasSuggestedTime);
    let suggestedStartMinutes = hasSuggestedTime ? raw.suggestedStartMinutes : null;
    let suggestedEndMinutes = hasSuggestedTime ? raw.suggestedEndMinutes : null;
    let warning = null;

    if (typeof scheduledDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(scheduledDate)) {
      scheduledDate = item.deadline ?? today;
      warning = "AI가 날짜를 제안하지 못해 기본값으로 배치했습니다.";
    }

    // exact: 날짜를 무조건 강제. 마감(soft): 마감일을 넘지 않게, 오늘보다 이전이면 오늘로.
    if (item.exact && item.deadline) {
      scheduledDate = item.deadline;
    } else if (item.deadline && scheduledDate > item.deadline) {
      scheduledDate = item.deadline;
    }
    if (scheduledDate < today) scheduledDate = today;

    if (hasSuggestedTime) {
      const validRange =
        Number.isInteger(suggestedStartMinutes) &&
        Number.isInteger(suggestedEndMinutes) &&
        suggestedStartMinutes >= 0 &&
        suggestedEndMinutes <= 1439 &&
        suggestedEndMinutes > suggestedStartMinutes;

      if (!validRange) {
        hasSuggestedTime = false;
        suggestedStartMinutes = null;
        suggestedEndMinutes = null;
      } else if (scheduledDate === today && suggestedStartMinutes < nowMinutes) {
        hasSuggestedTime = false;
        suggestedStartMinutes = null;
        suggestedEndMinutes = null;
        warning = "제안된 시각이 이미 지나서 시간 없이 배치했습니다.";
      } else if (findTimeConflict(scheduledDate, suggestedStartMinutes, suggestedEndMinutes, busyEvents)) {
        hasSuggestedTime = false;
        suggestedStartMinutes = null;
        suggestedEndMinutes = null;
        warning = "제안된 시간이 기존 일정과 겹쳐서 시간 없이 배치했습니다.";
      }
    }

    // 같은 배치 안에서 이미 확정된(더 높은 우선순위) 항목과 겹치면 이 항목이 양보한다.
    if (hasSuggestedTime) {
      const collides = results.some(
        (other) =>
          other &&
          other.scheduledDate === scheduledDate &&
          other.hasSuggestedTime &&
          overlaps(suggestedStartMinutes, suggestedEndMinutes, other.suggestedStartMinutes, other.suggestedEndMinutes)
      );
      if (collides) {
        hasSuggestedTime = false;
        suggestedStartMinutes = null;
        suggestedEndMinutes = null;
        warning = "같은 시간대에 다른 할일과 겹쳐서 시간 없이 배치했습니다.";
      }
    }

    results[index] = {
      ...item,
      scheduledDate,
      hasSuggestedTime,
      suggestedStartMinutes,
      suggestedEndMinutes,
      warning,
      reasoning: typeof raw.reasoning === "string" ? raw.reasoning : null,
    };
  }

  return results;
}

// taskItems를 받아서 "확정 전 미리보기"용 draft를 만든다. Google/Supabase에는
// 아무것도 쓰지 않는다 (부작용은 listEvents/getTasks 조회뿐). /api/dump와
// /api/dump/replan이 공유한다.
export async function buildTaskDraft({ taskItems, userContext, latestFeedback = null }) {
  const today = todayStr();
  const deadlines = taskItems.map((i) => i.deadline).filter(Boolean);
  const windowTo =
    deadlines.length > 0 ? deadlines.reduce((a, b) => (a > b ? a : b)) : addDays(today, FALLBACK_WINDOW_DAYS);

  let finalized;
  let placementFallback = false;

  try {
    const [busyEvents, existingTasks] = await Promise.all([
      listEvents(`${today}T00:00:00+09:00`, `${addDays(windowTo, 1)}T00:00:00+09:00`),
      getTasks(),
    ]);
    const busyTasks = existingTasks.filter(
      (t) => t.scheduledDate && t.scheduledDate >= today && t.scheduledDate <= windowTo && !t.done
    );

    const placements = await suggestPlacements({
      items: taskItems,
      busyEvents,
      busyTasks,
      windowTo,
      userContext,
      latestFeedback,
    });
    finalized = applyGuardrails({ items: taskItems, placements, busyEvents });
  } catch {
    // AI 배치 제안이 실패하면(모델 오류, 네트워크 등) 예전의 기계적 분산 방식으로 대체한다.
    placementFallback = true;
    const dayCounts = buildDayCounts(await getTasks());
    finalized = taskItems.map((item) => {
      const toDateStr = item.deadline ?? today;
      const day =
        item.exact && item.deadline
          ? item.deadline
          : pickDayWithCapacity({
              fromDateStr: today,
              toDateStr,
              maxPerDay: FALLBACK_MAX_TASKS_PER_DAY,
              dayCounts,
            });
      if (day) dayCounts.set(day, (dayCounts.get(day) ?? 0) + 1);
      return {
        ...item,
        scheduledDate: day ?? today,
        hasSuggestedTime: false,
        suggestedStartMinutes: null,
        suggestedEndMinutes: null,
        warning: day ? null : `오늘부터 ${toDateStr}까지 이미 꽉 찼습니다.`,
        reasoning: null,
      };
    });
  }

  const items = finalized.map((item) => ({
    ...item,
    displayLine: item.hasSuggestedTime
      ? `${formatKoreanDate(item.scheduledDate)} ${formatMinutesAsTime(
          item.suggestedStartMinutes
        )}~${formatMinutesAsTime(item.suggestedEndMinutes)} "${item.title}"`
      : `${formatKoreanDate(item.scheduledDate)} "${item.title}"`,
    // exact가 아닌 마감(deadline) 항목은 확정 시 할 일과 별개로 마감 표시(🔔)
    // 캘린더 이벤트도 같이 생긴다 — 확정 전 미리보기에서 미리 알려준다.
    deadlineNote:
      item.deadline && !item.exact
        ? `🔔 ${formatKoreanDate(item.deadline)}에 마감 표시 일정도 함께 등록돼요`
        : null,
  }));

  return { items, placementFallback };
}

// 일정(event) 항목용 draft — 날짜/시간이 이미 텍스트에서 확정됐으므로 AI 배치
// 판단은 필요 없고, 미리보기에 보여줄 displayLine만 계산한다. 부작용 없음.
export function buildEventDraftItems(eventItems) {
  return eventItems.map((item) => {
    const title = item.title;

    if (!item.hasTime) {
      const dateMatch = String(item.startTime).match(/^(\d{4}-\d{2}-\d{2})/);
      const dateStr = dateMatch ? dateMatch[1] : null;
      return {
        ...item,
        displayLine: dateStr
          ? `📅 ${formatKoreanDate(dateStr)} 하루종일 "${title}"`
          : `📅 "${title}" (날짜를 해석하지 못했습니다)`,
      };
    }

    const parsedStart = parseStartTime(item.startTime);
    if (!parsedStart) {
      return { ...item, displayLine: `📅 "${title}" (시간을 해석하지 못했습니다)` };
    }

    const endMinutes = parsedStart.minutes + (item.estimatedMinutes ?? 60);
    return {
      ...item,
      displayLine: `📅 ${formatKoreanDate(parsedStart.dateStr)} ${formatMinutesAsTime(
        parsedStart.minutes
      )}~${formatMinutesAsTime(endMinutes)} "${title}"`,
    };
  });
}
