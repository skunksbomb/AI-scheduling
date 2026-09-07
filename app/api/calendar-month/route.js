import { NextResponse } from "next/server";
import { listEvents } from "@/lib/googleCalendar";
import { listTasksDueBetween } from "@/lib/googleTasks";
import { getCurrentUser } from "@/lib/auth";
import { toDateStr } from "@/lib/dates";

export async function GET(request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const year = Number(searchParams.get("year"));
  const month = Number(searchParams.get("month")); // 1~12

  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return NextResponse.json({ error: "year, month 파라미터가 필요합니다." }, { status: 400 });
  }

  // 월 그리드에는 앞뒤 달 날짜도 일부 걸치니, 여유 있게 하루씩 더 넓혀서 가져온다.
  const monthStart = toDateStr(new Date(year, month - 1, 1));
  const monthEnd = toDateStr(new Date(year, month, 1));
  const timeMin = `${monthStart}T00:00:00+09:00`;
  const timeMax = `${monthEnd}T00:00:00+09:00`;

  const [events, tasks] = await Promise.all([
    listEvents(user.refreshToken, timeMin, timeMax),
    listTasksDueBetween(user.refreshToken, monthStart, monthEnd),
  ]);
  return NextResponse.json({ events, tasks });
}
