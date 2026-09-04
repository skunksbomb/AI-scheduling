import { NextResponse } from "next/server";
import { getUserContext } from "@/lib/store";
import { parseDumpText } from "@/lib/ai";
import { quadrantRank } from "@/lib/scheduling";
import { buildTaskDraft, buildEventDraftItems } from "@/lib/placement";

export async function POST(request) {
  const { text } = await request.json();

  if (!text || !text.trim()) {
    return NextResponse.json({ error: "내용을 입력해주세요." }, { status: 400 });
  }

  const userContext = await getUserContext();

  let parsedItems, uncertain, reason;
  try {
    ({ tasks: parsedItems, uncertain, reason } = await parseDumpText(text, userContext));
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }

  // 중요한 일부터 먼저 처리되도록 아이젠하워 우선순위로 정렬
  const sortedItems = [...parsedItems].sort((a, b) => quadrantRank(a) - quadrantRank(b));
  const eventItems = sortedItems.filter((item) => item.type === "event" && item.startTime);
  const taskItems = sortedItems.filter((item) => !(item.type === "event" && item.startTime));

  // 일정(event)도 할일과 마찬가지로 곧바로 커밋하지 않고, 미리보기(draft)로만
  // 보여준다 — AI 파싱이 항상 맞는 건 아니라서 사용자 확인을 거친다.
  const eventDraftItems = buildEventDraftItems(eventItems);

  let taskDraftItems = [];
  let placementFallback = false;
  if (taskItems.length > 0) {
    const result = await buildTaskDraft({ taskItems, userContext });
    taskDraftItems = result.items;
    placementFallback = result.placementFallback;
  }

  const allItems = [...eventDraftItems, ...taskDraftItems];
  const taskDraft = allItems.length > 0 ? { items: allItems, placementFallback, rawText: text } : null;

  return NextResponse.json({ uncertain, reason, taskDraft });
}
