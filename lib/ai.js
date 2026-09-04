import OpenAI from "openai";
import { toDateStr } from "@/lib/dates";

const WEEKDAY_NAMES = ["일요일", "월요일", "화요일", "수요일", "목요일", "금요일", "토요일"];

const WEEK_LABELS = ["이번주", "다음주", "다다음주"];

// LLM은 미래 날짜의 요일 계산과 "이번주/다음주" 주 경계 판단을 자주 틀리기 때문에,
// 날짜->요일->몇 번째 주인지까지 코드로 정확히 계산해서 표로 던져주고
// AI는 표에서 찾기만 하게 한다.
export function buildDateTable(days = 21) {
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
    else if (i === 2) label += " (모레)";
    else if (i === 3) label += " (글피)";
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
- "event": 다른 사람과의 약속/회의/행사처럼 특정 날짜에 벌어지는 일이거나, **어딘가에 가는/방문하는
  일**. 예: "3시에 민수랑 약속", "저녁 7시 회의", "9월 15일에 치과 예약", "내일 조재후랑 술약속",
  "내일 캘리포니아 빵집가기", "다음주 서울 갔을 때 안경집 가기". "~가기"/"~방문"/"~들르기"처럼
  장소를 향하는 표현이면, 그 장소에서 뭘 하는지와 상관없이 event로 본다 (직접 몸을 움직여 그
  장소에 가야 하는 일이므로 "실행해서 끝내는 작업"이 아니라 "벌어지는 일"에 가깝다). 텍스트에 몇
  시인지 실제로 적혀 있을 때만 hasTime: true로 하고 startTime에 그 시각을 채운다. "내일", "다음주
  화요일"처럼 날짜(요일)만 있고 몇 시인지 안 적혀 있으면 반드시 hasTime: false로 하고 startTime에는
  시각 없이 날짜만 쓴다. 시각을 모르면서 hasTime을 true로 하거나 00:00 같은 시각을 지어내는 것은
  절대 금지.
- "task": 장소 이동 없이 실행해서 끝내야 하는 작업. 예: "수학숙제 하기", "청소하기", "보고서 작성".
  deadline에 관련 날짜를 채우고 startTime은 null로 둔다. 두 가지로 나뉜다:
  - 기한만 있고 정확히 언제 할지는 정해지지 않음(exact: false): 예: "영어숙제 마감", "이번주까지 보고서 제출".
    '마감'/'까지'/'제출'처럼 기한을 말하는 표현이 있으면 이쪽이다. deadline까지 아무 날에나 배치해도 된다.
  - 정확히 그 날 하겠다고 못박음(exact: true): 예: "내일 아침에 수학숙제 하기", "오늘 저녁에 청소하기".
    기한 표현 없이 "내일/오늘/X요일에 ~하기"처럼 실행할 날짜 자체를 지정한 경우 이쪽이다. deadline에
    그 날짜를 채우고, 다른 날로 옮기면 안 된다.
- 구분이 애매하면: 장소에 가는 일이면 event, "제출/작성/준비/청소/공부"처럼 장소 이동 없이 스스로
  시간을 들여 해내야 하는 작업이면 task로 본다.

title 작성 예시:
- 입력 "다음주 화요일 영어숙제 마감" → title: "영어숙제" (O), "영어숙제 마감" (X, '마감' 넣지 말 것)
- 입력 "이번주까지 보고서 제출" → title: "보고서 제출" (O), "보고서 제출까지" (X)
- 입력 "내일 조재후랑 술약속" → title: "조재후와 술약속" (O, 사람 이름 유지), "술약속" (X, 이름 누락)
title은 마감/시간 표현만 뺀 나머지 내용(사람 이름, 대상, 장소 등)은 그대로 담는다. 마감 정보는 deadline
필드가 이미 갖고 있다.

날짜/요일 표 (직접 계산하지 말고 반드시 이 표에서 찾아서 쓸 것):
{{DATE_TABLE}}

사용자 개인 컨텍스트 (평소 반복되는 상황. 날짜 해석과 판단에 참고할 것):
{{USER_CONTEXT}}

날짜 해석 규칙:
- 표의 각 줄에는 [이번주]/[다음주]/[다다음주] 라벨이 붙어 있다. "이번주 X요일", "다음주 X요일"은
  직접 계산하지 말고 표에서 해당 라벨 + 해당 요일이 붙은 줄을 그대로 찾아 그 날짜를 쓴다.
- 요일만 말하고 주 표현이 없으면(예: "화요일까지") 오늘 이후 가장 가까운 그 요일.
- "오늘", "내일", "모레", "글피"처럼 표에 (오늘)/(내일)/(모레)/(글피)로 직접 표시된 건 계산하지 말고
  그 라벨이 붙은 줄을 그대로 찾는다.
- 그 외에 "5일 후"처럼 표에 라벨이 없는 상대적 날짜 표현은: 오늘 기준 며칠 후인지 숫자를 먼저 구하고,
  표에서 그 숫자와 일치하는 "(D+N)" 라벨이 붙은 줄을 찾아 그 줄의 날짜를 그대로 쓴다. 요일이나 달력을
  직접 계산하지 말고, 반드시 표에서 찾을 것.
- 사용자 개인 컨텍스트에 반복되는 요일 패턴(예: "매주 금요일마다 서울감", "매주 일요일마다 대전으로
  내려감")이 있고, 텍스트가 그 패턴과 관련된 장소/계기를 가리키면(예: "다음번 서울 올라가기 전에",
  "다음주 서울 갔을 때", "서울 올라가서"): 여러 날짜를 놓고 고민하거나 기간을 계산하지 말고, 텍스트가
  가리키는 상황과 가장 직접적으로 일치하는 컨텍스트 문장을 하나 고른 뒤 그 문장에 적힌 요일을 그대로
  표에서 찾아 쓰세요.
  - 예: "서울 올라가서/갔을 때"는 "매주 금요일마다 대전에서 서울로 올라감"이라는 문장과 일치하므로
    그 문장의 금요일을 쓴다. "서울에서 내려올 때"는 일요일 문장과 일치하므로 그 문장의 일요일을 쓴다.
  - "이번주"/"다음주" 수식어가 있으면 표에서 그 주 라벨 + 방금 고른 요일이 붙은 줄을, 수식어가
    없으면("다음번") 오늘 이후 가장 가까운 그 요일이 붙은 줄을 찾는다.
  - 이렇게 찾은 날짜는, 위 type 구분 기준에 따라 event면 startTime에(장소 방문이면 대부분 event이므로
    hasTime은 시각 언급이 없는 한 false), task면 deadline에 채운다.
- 한 문장에 항목이 여러 개면 여러 개로 나누세요.

tasks를 빈 배열로 반환하는 것에 대한 매우 중요한 경고:
- 사용자는 원래 "노트북 거치대 사기", "일상 루틴 만들기", "헬스 공부하기"처럼 날짜도 세부사항도 전혀
  없는 막연한 메모를 그냥 던져두는 습관이 있고, 이런 메모를 알아서 잘 정리해주는 게 이 프로그램의
  핵심 목적입니다. "~하기", "~사기", "~만들기", "~공부하기"처럼 행동을 가리키는 표현이 조금이라도
  있으면, 날짜·세부사항이 전혀 없어도 반드시 tasks에 항목을 채워 넣으세요 (deadline: null, exact:
  false로 두면 됩니다). **막연하다는 이유만으로 tasks를 비우면 절대 안 됩니다.**
- tasks를 빈 배열로 반환하는 건, 텍스트에 행동을 가리키는 표현이 정말 하나도 없을 때뿐입니다
  (예: 의미 없는 문자 나열 "asdkjaslkdj", 감탄사만 있는 경우).

uncertain 판단 기준:
- uncertain은 "이 텍스트에서 할 일/일정을 전혀 알아볼 수 없다"고 판단될 때만 true로 하세요
  (의미 없는 문자 나열 등). 내용이 막연하거나 구체적이지 않다는 이유만으로는 uncertain을 true로
  하지 마세요 — "일상 루틴 만들기"처럼 무엇을 할지는 분명하지만 날짜/세부사항이 없는 건 명확한
  할 일이지 애매한 게 아닙니다.
- 할 일인지 일정인지 구분이 진짜 애매하거나, 날짜·시간·제목 중 하나라도 확신 없이 추측해야 했다면
  uncertain을 true로 설정하고 reason에 이유를 한 문장으로 적으세요. 이 경우에도 위 경고에 따라
  tasks는 최선을 다해 채우세요.
- 명확하게 해석했다면 uncertain: false, reason: null.`;

export function formatUserContext(userContext) {
  return userContext && userContext.length > 0
    ? userContext.map((line) => `- ${line}`).join("\n")
    : "(등록된 개인 컨텍스트 없음)";
}

export async function parseDumpText(text, userContext = []) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "OPENAI_API_KEY가 설정되어 있지 않습니다. .env.local 파일에 키를 추가해주세요."
    );
  }

  const client = new OpenAI({ apiKey });
  const systemPrompt = SYSTEM_PROMPT.replace("{{DATE_TABLE}}", buildDateTable()).replace(
    "{{USER_CONTEXT}}",
    formatUserContext(userContext)
  );

  const completion = await client.chat.completions.create({
    model: process.env.OPENAI_PLACEMENT_MODEL || "gpt-4o",
    temperature: 0,
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

// 확인 화면에서 사용자가 준 피드백이, 앞으로도 계속 참고할 만한 반복되는
// 습관/선호인지, 아니면 이번 한 번만 해당하는 일회성 지시인지 GPT가 판단한다.
// 기억할 가치가 있으면 깔끔한 한 문장으로 다듬어서 반환한다.
export async function distillContextNote(feedback) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY가 설정되어 있지 않습니다.");
  }

  const client = new OpenAI({ apiKey });
  const systemPrompt = `사용자가 방금 할 일 배치 화면에서 어떤 항목 하나에 대해 이런 피드백을 줬습니다:
"${feedback}"

기본값은 shouldRemember: false입니다. 아래 조건을 확실히 만족할 때만 true로 하세요 — 애매하면
무조건 false입니다. "뭔가 배치 규칙 같아 보인다"는 것만으로 저장하지 마세요.

shouldRemember: true로 할 조건 (전부 만족해야 함):
1. 지금 이 할 일 하나에 국한된 얘기가 아니라, 사용자의 삶에 대한 진짜 일반적인 사실/습관/제약이다
   (예: "매주 금요일마다 서울감", "나는 저녁엔 운동해서 아무것도 못함", "성심당은 아침 일찍 가야 안 기다려").
2. 이 항목이 무엇에 관한 얘기였는지 몰라도, 문장 그 자체만 읽어서 무슨 뜻인지 완전히 이해된다
   (특정 할 일 제목이나 "이거", "그거" 같은 지시어에 의존하지 않는다).
3. "오늘/내일/이번주/다음주"처럼 상대적인 시간 표현을 쓰지 않는다 — 이런 건 시간이 지나면 뜻이
   바뀌어서 저장해두면 오히려 틀린 정보가 된다. 특정 날짜에만 해당하는 얘기면 저장하지 않는다.

shouldRemember: false로 해야 하는 예 (저장하면 안 되는 것들):
- "서울에 있는 날짜 중에서 골라줘" — 이 할 일 하나의 배치 방법일 뿐, 문맥 없인 무슨 뜻인지도 모름
- "다음주는 일정이 바쁨" — "다음주"가 상대적 표현이라 나중엔 틀린 정보가 됨
- "이번엔 오후로 옮겨줘" — 이번 한 번만 해당하는 지시

true인 경우, 그 내용을 위 조건을 만족하도록 짧고 명확한 한 문장으로 다듬어서("~함"/"~임" 체)
note에 담으세요.

설명 없이 JSON만 출력하세요: {"shouldRemember": true 또는 false, "note": "문장" 또는 null}`;

  const completion = await client.chat.completions.create({
    model: process.env.OPENAI_PLACEMENT_MODEL || "gpt-4o",
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [{ role: "system", content: systemPrompt }],
  });

  const raw = completion.choices[0]?.message?.content;
  if (!raw) {
    throw new Error("피드백 판단 응답에서 텍스트를 찾지 못했습니다.");
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("피드백 판단 응답을 JSON으로 해석하지 못했습니다: " + raw);
  }

  return {
    shouldRemember: Boolean(parsed.shouldRemember),
    note: typeof parsed.note === "string" ? parsed.note : null,
  };
}
