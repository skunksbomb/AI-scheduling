import OpenAI from "openai";

const WEEKDAY_NAMES = ["일요일", "월요일", "화요일", "수요일", "목요일", "금요일", "토요일"];

// LLM은 미래 날짜의 요일 계산을 자주 틀리기 때문에, 날짜->요일 매핑을
// 코드로 정확히 계산해서 표로 던져주고 AI는 표에서 찾기만 하게 한다.
function buildDateTable(days = 21) {
  const rows = [];
  const base = new Date();
  base.setHours(0, 0, 0, 0);

  for (let i = 0; i < days; i++) {
    const d = new Date(base);
    d.setDate(base.getDate() + i);
    const iso = d.toISOString().slice(0, 10);
    const weekday = WEEKDAY_NAMES[d.getDay()];
    let label = weekday;
    if (i === 0) label += " (오늘)";
    else if (i === 1) label += " (내일)";
    rows.push(`${iso} ${label}`);
  }
  return rows.join("\n");
}

const SYSTEM_PROMPT = `당신은 할 일 정리 비서입니다. 사용자가 자유롭게 적은 메모 텍스트를 읽고,
그 안에 담긴 할 일들을 아이젠하워 매트릭스 기준으로 분류해서 JSON으로만 답하세요.
설명 없이 다음 형식의 JSON 객체 하나만 출력합니다:

{
  "tasks": [
    {
      "title": "할 일 제목 (간결하게)",
      "deadline": "YYYY-MM-DD 형식 마감일 또는 null",
      "urgent": true 또는 false (마감이 임박했는가),
      "important": true 또는 false (목표/성적/약속 등에 큰 영향을 주는가),
      "estimatedMinutes": 예상 소요 시간(분, 정수), 모르면 60
    }
  ]
}

날짜/요일 표 (직접 계산하지 말고 반드시 이 표에서 찾아서 쓸 것):
{{DATE_TABLE}}

날짜 해석 규칙:
- "이번주 X요일"은 위 표에서 오늘이 속한 주(월요일~일요일)의 X요일.
- "다음주 X요일"은 이번주 다음 주(월~일)의 X요일. 표에서 오늘 이후 첫 번째 월요일부터 그 다음 일요일까지 범위 안에서 찾는다.
- 요일만 말하고 "다음주"가 없으면(예: "화요일까지") 오늘 이후 가장 가까운 그 요일.
- 위 규칙과 표를 이용해 정확한 YYYY-MM-DD를 찾고, 절대 스스로 요일을 계산하지 말 것.
- 한 문장에 할 일이 여러 개면 여러 항목으로 나누세요.`;

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
