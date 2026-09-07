import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { exchangeCodeForTokens, fetchGoogleProfile } from "@/lib/googleAuth";
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
