import { formatKoreanDate, parseStartTime } from "@/lib/dates";

function normalizeTitle(title) {
  return String(title ?? "").replace(/\s+/g, "").toLowerCase();
}

// AI가 existingIndex를 잘못 짚어서 전혀 무관한 항목을 가리키는 경우가 실제로
// 관측됐다(이미 지워진 항목을 다시 지우라고 하니 엉뚱한 진짜 일정을 삭제
// 대상으로 고른 사례). 프롬프트 지시만으론 100% 안 지켜져서, 코드에서 한 번
// 더 걸러낸다 — 삭제 시 title은 지시상 기존 항목 제목을 그대로 복사해야
// 하므로, 실제로 안 겹치면(서로 포함 관계도 아니면) 매칭이 틀렸다고 보고 버린다.
function titlesLooselyMatch(a, b) {
  const na = normalizeTitle(a);
  const nb = normalizeTitle(b);
  if (!na || !nb) return false;
  return na.includes(nb) || nb.includes(na);
}

// AI가 op: edit/delete로 분류한 항목들을, dump 확인 화면에 보여줄 draft로
// 바꾼다. add와 달리 AI 배치 판단이 필요 없다 — 날짜/시간은 사용자가 직접
// 지정했거나 AI가 날짜표에서 그대로 찾아온 값이라 추가 조정 없이 그대로 쓴다.
// existingItems 범위를 벗어난 existingIndex는 조용히 걸러낸다(가리키는 대상이
// 없으면 반영할 방법이 없으므로).
export function buildExistingItemDrafts(items, existingItems) {
  const drafts = [];
  for (const item of items) {
    const existing = existingItems[item.existingIndex];
    if (!existing) continue;

    if (item.op === "delete") {
      if (!titlesLooselyMatch(item.title, existing.title)) continue;
      drafts.push({
        op: "delete",
        kind: existing.kind,
        existingId: existing.id,
        title: existing.title,
        displayLine: `🗑 "${existing.title}" 삭제`,
      });
      continue;
    }

    if (item.op === "edit") {
      if (existing.kind === "event") {
        // 날짜를 안 바꾸는 edit이면 AI가 startTime을 안 채워도(지시상으론 기존
        // 값을 그대로 옮겨 써야 하지만 실제로 종종 누락됨) 기존 일정의 날짜로
        // 대체한다 — 안 그러면 "undefined월 undefined일" 같은 깨진 문구가 그대로
        // 화면에 나간다(실제로 관측된 버그).
        const startTimeStr =
          item.startTime && /^\d{4}-\d{2}-\d{2}/.test(String(item.startTime)) ? item.startTime : existing.dateStr;
        const label = item.hasTime
          ? (() => {
              const parsed = parseStartTime(startTimeStr);
              return parsed
                ? `${formatKoreanDate(parsed.dateStr)} ${String(Math.floor(parsed.minutes / 60)).padStart(2, "0")}:${String(parsed.minutes % 60).padStart(2, "0")}`
                : `${formatKoreanDate(existing.dateStr)} 하루종일`;
            })()
          : `${formatKoreanDate(String(startTimeStr).slice(0, 10))} 하루종일`;
        drafts.push({
          op: "edit",
          kind: "event",
          existingId: existing.id,
          title: item.title,
          hasTime: Boolean(item.hasTime),
          startTime: startTimeStr,
          estimatedMinutes: item.estimatedMinutes ?? 60,
          displayLine: `✏️ "${existing.title}" → ${label} "${item.title}"`,
        });
      } else {
        drafts.push({
          op: "edit",
          kind: "task",
          existingId: existing.id,
          title: item.title,
          deadline: item.deadline ?? null,
          displayLine: `✏️ "${existing.title}" → ${
            item.deadline ? `마감 ${formatKoreanDate(item.deadline)}` : "마감 없음"
          }, 제목 "${item.title}"`,
        });
      }
    }
  }
  return drafts;
}
