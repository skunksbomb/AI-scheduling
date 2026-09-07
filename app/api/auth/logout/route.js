import { NextResponse } from "next/server";
import { deleteSessionCookie } from "@/lib/auth";

// 앱 세션 쿠키만 지운다. 구글 쪽 권한 자체는 취소하지 않는다 — 사용자가
// 원하면 myaccount.google.com/permissions 에서 직접 취소할 수 있다.
export async function POST() {
  await deleteSessionCookie();
  return NextResponse.json({ ok: true });
}
