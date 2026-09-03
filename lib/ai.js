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

    let label = `${weekday} [${weekLabel}]`;
    if (i === 0) label += " (오늘)";
    else if (i === 1) label += " (내일)";
    rows.push(`${iso} ${label}`);
  }
  return rows.join("\n");
}

const SYSTEM_PROMPT = `당신은 할 일 정리 비서입니다. 사용자가 자유롭게 적은 메모 텍스트를 읽고,
그 안에 담긴 항목들을 분석해서 JSON으로만 답하세요. 설명 없이 다음 형식의 JSON 객체 하나만 출력합니다:

{
  "tasks": [
    {
      "type": "event" 또는 "task",
      "title": "제목 (간결한 명사구, '마감'/'까지'/날짜·시간 표현은 절대 포함하지 말 것)",
      "deadline": "YYYY-MM-DD 또는 null (type이 task일 때만 사용)",
      "startTime": "YYYY-MM-DDTHH:mm 또는 null (type이 event일 때만 사용, 24시간제)",
      "urgent": true 또는 false,
      "important": true 또는 false,
      "estimatedMinutes": 예상 소요 시간(분, 정수), 모르면 60
    }
  ]
}

type 구분 기준:
- "event": 다른 사람과의 약속/회의처럼 실행 시각이 명시된 항목. 예: "3시에 민수랑 약속", "저녁 7시 회의".
  이 경우 startTime에 실제 시각을 채운다.
- "task": 마감일만 있고 언제 할지는 정해지지 않은 할 일. 예: "영어숙제 마감", "보고서 작성".
  이 경우 deadline에 마감일을 채우고 startTime은 null로 둔다.

title 작성 예시:
- 입력 "다음주 화요일 영어숙제 마감" → title: "영어숙제" (O), "영어숙제 마감" (X, '마감' 넣지 말 것)
- 입력 "이번주까지 보고서 제출" → title: "보고서 제출" (O), "보고서 제출까지" (X)
title은 마감/시간 표현을 뺀 할 일 자체의 이름만 담는다. 마감 정보는 deadline 필드가 이미 갖고 있다.

날짜/요일 표 (직접 계산하지 말고 반드시 이 표에서 찾아서 쓸 것):
{{DATE_TABLE}}

날짜 해석 규칙:
- 표의 각 줄에는 [이번주]/[다음주]/[다다음주] 라벨이 붙어 있다. "이번주 X요일", "다음주 X요일"은
  직접 계산하지 말고 표에서 해당 라벨 + 해당 요일이 붙은 줄을 그대로 찾아 그 날짜를 쓴다.
- 요일만 말하고 주 표현이 없으면(예: "화요일까지") 오늘 이후 가장 가까운 그 요일.
- "오늘 저녁", "내일" 등도 표를 이용해 정확한 YYYY-MM-DD로 변환.
- 위 규칙과 표를 이용해 정확한 날짜를 찾고, 절대 스스로 요일을 계산하지 말 것.
- 한 문장에 항목이 여러 개면 여러 개로 나누세요.`;

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

  return parsed.tasks;
}
