import OpenAI from "openai";
import { toDateStr } from "@/lib/dates";

const WEEKDAY_NAMES = ["일요일", "월요일", "화요일", "수요일", "목요일", "금요일", "토요일"];

const WEEK_LABELS = ["이번주", "다음주", "다다음주"];

// LLM은 미래 날짜의 요일 계산과 "이번주/다음주" 주 경계 판단을 자주 틀리기 때문에,
// 날짜->요일->몇 번째 주인지까지 코드로 정확히 계산해서 표로 던져주고
// AI는 표에서 찾기만 하게 한다.
function buildDateTable(days = 21) {
  const rows = [];
  const base = new Date();
  base.setHours(0, 0, 0, 0);

  // 이번주 월요일 (일요일=0 기준 보정)
  const daysSinceMonday = (base.getDay() + 6) % 7;
  const thisWeekMonday = new Date(base);
  thisWeekMonday.setDate(base.getDate() - daysSinceMonday);

  for (let i = 0; i < days; i++) {
    const d = new Date(base);
    d.setDate(base.getDate() + i);
    const iso = toDateStr(d);
    const weekday = WEEKDAY_NAMES[d.getDay()];

    const weekIndex = Math.floor((d - thisWeekMonday) / (7 * 24 * 60 * 60 * 1000));
    const weekLabel = WEEK_LABELS[weekIndex] ?? `${weekIndex}주 후`;

    let label = `${weekday} [${weekLabel}] (D+${i})`;
    if (i === 0) label += " (오늘)";
    else if (i === 1) label += " (내일)";
    rows.push(`${iso} ${label}`);
  }
  return rows.join("\n");
}

const SYSTEM_PROMPT = `당신은 할 일 정리 비서입니다. 사용자가 자유롭게 적은 메모 텍스트를 읽고,
그 안에 담긴 항목들을 분석해서 JSON으로만 답하세요. 설명 없이 다음 형식의 JSON 객체 하나만 출력합니다:

{
  "uncertain": true 또는 false,
  "reason": "판단이 애매했던 이유를 한 문장으로 (uncertain이 true일 때만 채우고, false면 null)",
  "tasks": [
    {
      "type": "event" 또는 "task",
      "title": "제목 (사람 이름·대상 등 구체적인 정보는 유지하고, '마감'/'까지'/날짜·시간 표현만 뺀 명사구)",
      "deadline": "YYYY-MM-DD 또는 null (type이 task일 때만 사용)",
      "exact": "type이 task일 때만 사용, 그 외엔 false. 사용자가 '이 날짜까지만 끝내면 됨'이 아니라 '정확히 이 날 하겠다'고 날짜를 못박은 경우 true, 기한만 말한 경우 false",
      "hasTime": "type이 event일 때만 사용, 그 외엔 false. 텍스트에 실제 시각(몇 시)이 언급되어 있으면 true, 날짜만 있고 시각 언급이 전혀 없으면 반드시 false",
      "startTime": "type이 event일 때만 사용, 그 외엔 null. hasTime이 true면 'YYYY-MM-DDTHH:mm'(24시간제). hasTime이 false면 시각 부분 없이 'YYYY-MM-DD'만 쓰고, 절대 00:00 등 시각을 지어내지 말 것",
      "urgent": true 또는 false,
      "important": true 또는 false,
      "estimatedMinutes": 예상 소요 시간(분, 정수), 모르면 60
    }
  ]
}

type 구분 기준:
- "event": 다른 사람과의 약속/회의/행사처럼 특정 날짜에 벌어지는 일. 예: "3시에 민수랑 약속", "저녁 7시 회의",
  "9월 15일에 치과 예약", "내일 조재후랑 술약속". 텍스트에 몇 시인지 실제로 적혀 있을 때만 hasTime: true로
  하고 startTime에 그 시각을 채운다. "내일", "다음주 화요일"처럼 날짜(요일)만 있고 몇 시인지 안 적혀
  있으면 반드시 hasTime: false로 하고 startTime에는 시각 없이 날짜만 쓴다. 시각을 모르면서 hasTime을
  true로 하거나 00:00 같은 시각을 지어내는 것은 절대 금지.
- "task": 실행해서 끝내야 하는 작업. deadline에 관련 날짜를 채우고 startTime은 null로 둔다. 두 가지로
  나뉜다:
  - 기한만 있고 정확히 언제 할지는 정해지지 않음(exact: false): 예: "영어숙제 마감", "이번주까지 보고서 제출".
    '마감'/'까지'/'제출'처럼 기한을 말하는 표현이 있으면 이쪽이다. deadline까지 아무 날에나 배치해도 된다.
  - 정확히 그 날 하겠다고 못박음(exact: true): 예: "내일 아침에 수학숙제 하기", "오늘 저녁에 청소하기".
    기한 표현 없이 "내일/오늘/X요일에 ~하기"처럼 실행할 날짜 자체를 지정한 경우 이쪽이다. deadline에
    그 날짜를 채우고, 다른 날로 옮기면 안 된다.
- 구분이 애매하면: "예약/회의/약속/행사" 등 특정 날짜에 벌어지는 일이면 event, "제출/작성/준비"처럼
  스스로 시간을 들여 해내야 하는 작업이면 task로 본다.

title 작성 예시:
- 입력 "다음주 화요일 영어숙제 마감" → title: "영어숙제" (O), "영어숙제 마감" (X, '마감' 넣지 말 것)
- 입력 "이번주까지 보고서 제출" → title: "보고서 제출" (O), "보고서 제출까지" (X)
- 입력 "내일 조재후랑 술약속" → title: "조재후와 술약속" (O, 사람 이름 유지), "술약속" (X, 이름 누락)
title은 마감/시간 표현만 뺀 나머지 내용(사람 이름, 대상, 장소 등)은 그대로 담는다. 마감 정보는 deadline
필드가 이미 갖고 있다.

날짜/요일 표 (직접 계산하지 말고 반드시 이 표에서 찾아서 쓸 것):
{{DATE_TABLE}}

날짜 해석 규칙:
- 표의 각 줄에는 [이번주]/[다음주]/[다다음주] 라벨이 붙어 있다. "이번주 X요일", "다음주 X요일"은
  직접 계산하지 말고 표에서 해당 라벨 + 해당 요일이 붙은 줄을 그대로 찾아 그 날짜를 쓴다.
- 요일만 말하고 주 표현이 없으면(예: "화요일까지") 오늘 이후 가장 가까운 그 요일.
- "오늘", "내일"처럼 표에 (오늘)/(내일)로 직접 표시된 건 그대로 찾는다.
- "모레", "글피", "3일 후" 같이 오늘 기준 상대적인 날짜 표현은: 오늘 기준 며칠 후인지부터 계산한다
  (모레=2일 후, 글피=3일 후 — 이건 단순 어휘 지식이라 계산해도 된다). 그다음 표에서 그 숫자와 일치하는
  "(D+N)" 라벨이 붙은 줄을 찾아 그 줄의 날짜를 그대로 쓴다. 요일이나 달력을 직접 계산하지 말고, 반드시
  이 (D+N) 표시를 거쳐서 표에서 찾을 것.
- 한 문장에 항목이 여러 개면 여러 개로 나누세요.

uncertain 판단 기준:
- 텍스트에 할 일/일정으로 볼 만한 내용이 전혀 없거나(예: 의미 없는 문자 나열),
  할 일인지 일정인지 구분이 애매하거나, 날짜·시간·제목 중 하나라도 확신 없이 추측해야 했다면
  uncertain을 true로 설정하고 reason에 이유를 한 문장으로 적으세요.
- 이 경우에도 tasks는 최선을 다해 채우되(추측한 내용이라도), 할 일로 볼 내용이 아예 없으면
  tasks를 빈 배열로 반환하세요.
- 명확하게 해석했다면 uncertain: false, reason: null.`;

export async function parseDumpText(text) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "OPENAI_API_KEY가 설정되어 있지 않습니다. .env.local 파일에 키를 추가해주세요."
    );
  }

  const client = new OpenAI({ apiKey });
  const systemPrompt = SYSTEM_PROMPT.replace("{{DATE_TABLE}}", buildDateTable());

  const completion = await client.chat.completions.create({
    model: "gpt-4o-mini",
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: text },
    ],
  });

  const raw = completion.choices[0]?.message?.content;
  if (!raw) {
    throw new Error("AI 응답에서 텍스트를 찾지 못했습니다.");
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("AI 응답을 JSON으로 해석하지 못했습니다: " + raw);
  }

  if (!Array.isArray(parsed.tasks)) {
    throw new Error("AI 응답 형식이 올바르지 않습니다 (tasks 배열 없음).");
  }

  return {
    tasks: parsed.tasks,
    uncertain: Boolean(parsed.uncertain),
    reason: parsed.reason ?? null,
  };
}
