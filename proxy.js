import { NextResponse } from "next/server";

// 화면단 편의 기능일 뿐 진짜 보안 경계는 아니다 — 쿠키 서명만 가볍게 검증해서
// (DB 조회 없이) 없으면 로그인 페이지로 보낸다. 실제 인가는 각 API 라우트/서버
// 컴포넌트가 스스로 getCurrentUser()를 호출해서 확인한다 (lib/auth.js).
//
// /api/* 전체는 matcher에서 제외한다 — API 라우트는 각자 getCurrentUser()로
// 401을 직접 반환하는데, 여기서 먼저 /login으로 리다이렉트해버리면 클라이언트의
// apiFetch()가 401을 못 보고 로그인 페이지의 HTML을 그대로 JSON으로 파싱하려다
// 에러가 난다 (api/auth만 빼던 예전 버전에서 실제로 겪은 문제).
export function proxy(request) {
  const hasSessionCookie = Boolean(request.cookies.get("session")?.value);
  if (!hasSessionCookie) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!api|login|manifest.webmanifest|icon-192|icon-512|apple-icon|favicon.ico|_next/static|_next/image).*)",
  ],
};
