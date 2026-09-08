import { NextResponse } from "next/server";
import { appendUserContext, getUserContext } from "@/lib/store";
import { buildTaskDraft, buildEventDraftItems } from "@/lib/placement";
import { distillContextNote, parseDumpText } from "@/lib/ai";
import { getExistingItems, formatExistingItemsForPrompt } from "@/lib/existingItems";
import { buildExistingItemDrafts } from "@/lib/existingItemDrafts";
import { getCurrentUser } from "@/lib/auth";

function describePreviousItem(item) {
  if (item.op === "delete") return `- "${item.title}" 삭제 예정`;
  if (item.op === "edit") return `- "${item.title}" 수정 예정: ${item.displayLine}`;
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

// 피드백 한 라운드(직전 배치 상태 + 그때 사용자가 준 피드백)를 한 문단으로 묘사한다.
function describeRound(index, items, feedback) {
  const lines = items.map(describePreviousItem).join("\n");
  return `${index}차 시도 — AI가 이렇게 판단/배치했음:\n${lines}\n→ 사용자 피드백: "${feedback}"`;
}

// 확인 화면에서 사용자가 "이건 이래서 안 돼" 같은 피드백을 주면:
// 1) 그 피드백이 앞으로도 기억할 만한 내용인지 AI가 판단해서, 그렇다면 깔끔한
//    문장으로 다듬어 개인 컨텍스트에 저장한다 (일회성 지시면 저장 안 함).
// 2) 원래 dump 문장 + 이번 피드백을 다시 AI한테 같이 던져서 type/deadline/exact/
//    op(추가·수정·삭제) 판단 자체도 재해석시킨다.
// Google/Supabase에는 아무것도 쓰지 않는다.
export async function POST(request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const { items, feedback, rawText, feedbackHistory } = await request.json();

  if (!Array.isArray(items) || items.length === 0) {
    return NextResponse.json({ error: "다시 배치할 항목이 없습니다." }, { status: 400 });
  }

  const trimmedFeedback = feedback && feedback.trim() ? feedback.trim() : null;
  // 지금까지 몇 번 피드백을 주고받았든, 그 전체를 시간순으로 한 번에 넘겨야
  // AI가 "이전에 이미 이렇게 하기로 했었지" 하는 맥락을 잃지 않는다. 각 라운드는
  // 그때의 배치 상태 + 그때 준 피드백 한 쌍이고, 이번 라운드(가장 최근 상태 +
  // 방금 준 피드백)를 마지막에 이어붙인다.
  const priorRounds = Array.isArray(feedbackHistory) ? feedbackHistory : [];
  const roundsSoFar = trimmedFeedback ? [...priorRounds, { items, feedback: trimmedFeedback }] : priorRounds;
  let userContext = await getUserContext(user.id);
  const existingItems = await getExistingItems(user.id, user.refreshToken);

  if (trimmedFeedback) {
    try {
      const { shouldRemember, note } = await distillContextNote(trimmedFeedback);
      if (shouldRemember && note) {
        userContext = await appendUserContext(user.id, note);
      }
    } catch {
      // 판단 자체가 실패하면, 아예 기억을 못 하는 것보단 원문이라도 저장해둔다.
      userContext = await appendUserContext(user.id, trimmedFeedback);
    }
  }

  // 기존 항목 수정/삭제 draft는 재해석에 성공하면 통째로 새로 만들고, 실패하면
  // 지금 화면에 있던 걸 그대로 유지한다 (재배치 AI 파이프라인은 add에만 쓰임).
  let addItems = items.filter((i) => (i.op ?? "add") === "add");
  let existingItemDraftItems = items.filter((i) => i.op === "edit" || i.op === "delete");

  if (trimmedFeedback && rawText) {
    try {
      // 이번 한 번의 피드백뿐 아니라, 지금까지 있었던 모든 라운드(배치 상태 +
      // 그때의 피드백)를 시간순으로 그대로 보여줘야, 사용자가 정확히 뭘
      // 지적하는지(그리고 이전 라운드에서 이미 반영하기로 한 건 뭔지) 잃지 않고
      // 제대로 이해하고 재해석할 수 있다.
      const roundsText = roundsSoFar.map((r, i) => describeRound(i + 1, r.items, r.feedback)).join("\n\n");

      const enrichedText = `${rawText}

(다음은 지금까지 시간순으로 진행된 재배치 피드백 과정입니다. 이전 라운드에서 이미 반영하기로 한
내용은 계속 유지하면서, 아래 내용을 전부 종합해서 최종 판단하세요.)
${roundsText}`;

      const { tasks: reparsed } = await parseDumpText(
        enrichedText,
        userContext,
        formatExistingItemsForPrompt(existingItems)
      );
      if (reparsed.length > 0) {
        addItems = reparsed.filter((item) => (item.op ?? "add") === "add");
        existingItemDraftItems = buildExistingItemDrafts(
          reparsed.filter((item) => (item.op ?? "add") !== "add"),
          existingItems
        );
      }
    } catch {
      // 재해석 실패하면 기존 항목(시간대만 재조정)으로 계속 진행한다.
    }
  }

  const eventItems = addItems.filter((item) => item.type === "event" && item.startTime);
  const taskItems = addItems.filter((item) => !(item.type === "event" && item.startTime));

  const eventDraftItems = buildEventDraftItems(eventItems).map((i) => ({ ...i, op: "add" }));

  // 배치 판단(suggestPlacements) 쪽에도 이번 피드백 한 줄만이 아니라 지금까지의
  // 피드백을 전부 시간순 번호로 넘긴다 — 그래야 "저녁엔 하지마" 같은 이전
  // 라운드의 제약이 이번 재배치에서도 계속 지켜진다.
  const feedbackHistoryText = roundsSoFar.map((r, i) => `${i + 1}. "${r.feedback}"`).join("\n");

  let taskDraftItems = [];
  let placementFallback = false;
  if (taskItems.length > 0) {
    const result = await buildTaskDraft({
      userId: user.id,
      refreshToken: user.refreshToken,
      taskItems,
      userContext,
      latestFeedback: feedbackHistoryText || null,
    });
    taskDraftItems = result.items.map((i) => ({ ...i, op: "add" }));
    placementFallback = result.placementFallback;
  }

  return NextResponse.json({
    items: [...existingItemDraftItems, ...eventDraftItems, ...taskDraftItems],
    placementFallback,
    userContext,
    feedbackHistory: roundsSoFar,
  });
}
