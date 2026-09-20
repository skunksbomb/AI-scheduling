import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { exchangeCodeForTokens, fetchGoogleProfile, findMissingScopes } from "@/lib/googleAuth";
import { upsertUserByGoogleSub } from "@/lib/store";
import { createSessionCookie } from "@/lib/auth";

const STATE_COOKIE = "oauth_state";

export async function GET(request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  const cookieStore = await cookies();
  const expectedState = cookieStore.get(STATE_COOKIE)?.value;
  cookieStore.delete(STATE_COOKIE);

  if (!code || !state || state !== expectedState) {
    return NextResponse.redirect(new URL("/login?error=invalid_state", request.url));
  }

  try {
    const tokens = await exchangeCodeForTokens(code);

    // 동의 화면에서 캘린더/할일 체크박스를 끈 채로 로그인해도 구글은 토큰을
    // 정상 발급한다. 그대로 저장하면 이후 모든 캘린더/할일 호출이 403으로
    // 터지므로(실제로 겪었음), 여기서 막고 다시 로그인하게 돌려보낸다.
    // 기존에 저장된 멀쩡한 토큰을 덮어쓰지 않는 것도 중요하다.
    if (findMissingScopes(tokens.scope).length > 0) {
      return NextResponse.redirect(new URL("/login?error=missing_scope", request.url));
    }

    const profile = await fetchGoogleProfile(tokens.access_token);
    const user = await upsertUserByGoogleSub({
      googleSub: profile.sub,
      email: profile.email,
      name: profile.name,
      refreshToken: tokens.refresh_token,
    });
    await createSessionCookie(user.id);
    return NextResponse.redirect(new URL("/", request.url));
  } catch (err) {
    const code = err.message?.includes("refresh token") ? "no_refresh_token" : "unknown";
    return NextResponse.redirect(new URL(`/login?error=${code}`, request.url));
  }
}
