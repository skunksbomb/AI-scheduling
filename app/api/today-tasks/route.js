import { NextResponse } from "next/server";
import { completeTask, reopenTask } from "@/lib/googleTasks";
import { getCurrentUser } from "@/lib/auth";

// 홈 화면의 "오늘 일정"에 뜨는 할 일은 아이젠하워 매트릭스(Supabase)와 무관하게
// 구글 할 일 목록에서 오늘 마감인 것만 직접 읽어온 것이라, id도 Supabase row id가
// 아니라 구글 Task id 그대로다. 그래서 완료 토글도 구글에 직접 반영한다.
export async function PATCH(request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const { id, done } = await request.json();
  if (!id) return NextResponse.json({ error: "id가 필요합니다." }, { status: 400 });

  await (done ? completeTask(user.refreshToken, id) : reopenTask(user.refreshToken, id));
  return NextResponse.json({ ok: true });
}
