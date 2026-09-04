import { NextResponse } from "next/server";
import { appendUserContext, getUserContext } from "@/lib/store";
import { buildTaskDraft, buildEventDraftItems } from "@/lib/placement";
import { distillContextNote, parseDumpText } from "@/lib/ai";

function describePreviousItem(item) {
  if (item.type === "event") {
    return item.hasTime
      ? `- "${item.title}" (일정): ${item.startTime}`
      : `- "${item.title}" (일정, 시각 미정): ${item.startTime}`;
  }
  return (
    `- "${item.title}" (할일): deadline=${item.deadline ?? "없음"}, 배치일=${item.scheduledDate ?? "미정"}` +
    (item.reasoning ? `, AI의 판단 이유="${item.reasoning}"` : "")
  );
}

// 확인 화면에서 사용자가 "이건 이래서 안 돼" 같은 피드백을 주면:
// 1) 그 피드백이 앞으로도 기억할 만한 내용인지 AI가 판단해서, 그렇다면 깔끔한
//    문장으로 다듬어 개인 컨텍스트에 저장한다 (일회성 지시면 저장 안 함).
// 2) 원래 dump 문장 + 이번 피드백을 다시 AI한테 같이 던져서 type/deadline/exact
//    같은 항목 자체도 재해석시킨다 — 그래야 "마감 자체가 잘못 잡혔다", "이건 일정이지
//    할일이 아니다" 같은 피드백도 반영 가능하다.
// Google/Supabase에는 아무것도 쓰지 않는다.
export async function POST(request) {
  const { items, feedback, rawText } = await request.json();

  if (!Array.isArray(items) || items.length === 0) {
    return NextResponse.json({ error: "다시 배치할 항목이 없습니다." }, { status: 400 });
  }

  const trimmedFeedback = feedback && feedback.trim() ? feedback.trim() : null;
  let userContext = await getUserContext();

  if (trimmedFeedback) {
    try {
      const { shouldRemember, note } = await distillContextNote(trimmedFeedback);
      if (shouldRemember && note) {
        userContext = await appendUserContext(note);
      }
    } catch {
      // 판단 자체가 실패하면, 아예 기억을 못 하는 것보단 원문이라도 저장해둔다.
      userContext = await appendUserContext(trimmedFeedback);
    }
  }

  let eventItems = items.filter((i) => i.type === "event");
  let taskItems = items.filter((i) => i.type !== "event");

  if (trimmedFeedback && rawText) {
    try {
      // AI가 이전에 뭐라고 판단했었는지도 같이 넘겨야, 사용자가 정확히 뭘
      // 지적하는지(그리고 뭘 고쳐야 하는지) 제대로 이해하고 재해석할 수 있다.
      const previousResultLines = items.map(describePreviousItem).join("\n");

      const enrichedText = `${rawText}

(AI가 방금 전 이 문장을 아래와 같이 해석하고 배치했었음:
${previousResultLines})

(사용자가 그 결과에 대해 방금 이렇게 말함: "${trimmedFeedback}")`;

      const { tasks: reparsed } = await parseDumpText(enrichedText, userContext);
      if (reparsed.length > 0) {
        eventItems = reparsed.filter((item) => item.type === "event" && item.startTime);
        taskItems = reparsed.filter((item) => !(item.type === "event" && item.startTime));
      }
    } catch {
      // 재해석 실패하면 기존 항목(시간대만 재조정)으로 계속 진행한다.
    }
  }

  const eventDraftItems = buildEventDraftItems(eventItems);

  let taskDraftItems = [];
  let placementFallback = false;
  if (taskItems.length > 0) {
    const result = await buildTaskDraft({ taskItems, userContext, latestFeedback: trimmedFeedback });
    taskDraftItems = result.items;
    placementFallback = result.placementFallback;
  }

  return NextResponse.json({ items: [...eventDraftItems, ...taskDraftItems], placementFallback, userContext });
}
