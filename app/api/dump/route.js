import { NextResponse } from "next/server";
import { getUserContext } from "@/lib/store";
import { parseDumpText } from "@/lib/ai";
import { quadrantRank } from "@/lib/scheduling";
import { buildTaskDraft, buildEventDraftItems } from "@/lib/placement";
import { getExistingItems, formatExistingItemsForPrompt } from "@/lib/existingItems";
import { buildExistingItemDrafts } from "@/lib/existingItemDrafts";
import { getCurrentUser } from "@/lib/auth";

export async function POST(request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const { text } = await request.json();

  if (!text || !text.trim()) {
    return NextResponse.json({ error: "내용을 입력해주세요." }, { status: 400 });
  }

  const [userContext, existingItems] = await Promise.all([
    getUserContext(user.id),
    getExistingItems(user.id, user.refreshToken),
  ]);

  let parsedItems, uncertain, reason;
  try {
    ({ tasks: parsedItems, uncertain, reason } = await parseDumpText(
      text,
      userContext,
      formatExistingItemsForPrompt(existingItems)
    ));
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }

  // 기존 항목 수정/삭제(edit/delete)는 AI 배치 판단이 필요 없어 따로 처리하고,
  // 새로 추가하는 항목(add, 기본값)만 기존 배치 파이프라인을 그대로 탄다.
  const addItems = parsedItems.filter((item) => (item.op ?? "add") === "add");
  const editDeleteItems = parsedItems.filter((item) => (item.op ?? "add") !== "add");
  const existingItemDraftItems = buildExistingItemDrafts(editDeleteItems, existingItems);

  // 중요한 일부터 먼저 처리되도록 아이젠하워 우선순위로 정렬
  const sortedItems = [...addItems].sort((a, b) => quadrantRank(a) - quadrantRank(b));
  const eventItems = sortedItems.filter((item) => item.type === "event" && item.startTime);
  const taskItems = sortedItems.filter((item) => !(item.type === "event" && item.startTime));

  // 일정(event)도 할일과 마찬가지로 곧바로 커밋하지 않고, 미리보기(draft)로만
  // 보여준다 — AI 파싱이 항상 맞는 건 아니라서 사용자 확인을 거친다.
  const eventDraftItems = buildEventDraftItems(eventItems);

  let taskDraftItems = [];
  let placementFallback = false;
  if (taskItems.length > 0) {
    const result = await buildTaskDraft({ userId: user.id, refreshToken: user.refreshToken, taskItems, userContext });
    taskDraftItems = result.items;
    placementFallback = result.placementFallback;
  }

  const allItems = [
    ...existingItemDraftItems,
    ...eventDraftItems.map((i) => ({ ...i, op: "add" })),
    ...taskDraftItems.map((i) => ({ ...i, op: "add" })),
  ];
  const taskDraft = allItems.length > 0 ? { items: allItems, placementFallback, rawText: text } : null;

  return NextResponse.json({ uncertain, reason, taskDraft });
}
