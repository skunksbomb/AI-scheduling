import { cookies } from "next/headers";
import { createHmac, timingSafeEqual } from "crypto";
import { getUserById } from "@/lib/store";

const SESSION_COOKIE = "session";
const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60; // 구글 테스트 상태 토큰 만료 주기(7일)와 맞춤

function base64url(input) {
  return Buffer.from(input).toString("base64url");
}

function getSecret() {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error("SESSION_SECRET이 설정되어 있지 않습니다. .env.local을 확인하세요.");
  }
  return secret;
}

function sign(payload) {
  return base64url(createHmac("sha256", getSecret()).update(payload).digest());
}

// 쿠키엔 refresh token이나 이메일 같은 민감정보를 담지 않는다 — userId와
// 만료시각만 담고, 실제 사용자 정보는 매 요청마다 Supabase에서 다시 조회한다.
function signSession(userId) {
  const payload = base64url(JSON.stringify({ userId, exp: Date.now() + SESSION_MAX_AGE_SECONDS * 1000 }));
  return `${payload}.${sign(payload)}`;
}

function verifySession(cookieValue) {
  if (!cookieValue) return null;
  const [payload, signature] = cookieValue.split(".");
  if (!payload || !signature) return null;

  const expected = sign(payload);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    const { userId, exp } = JSON.parse(Buffer.from(payload, "base64url").toString());
    if (typeof userId !== "string" || typeof exp !== "number" || exp < Date.now()) return null;
    return { userId };
  } catch {
    return null;
  }
}

export async function createSessionCookie(userId) {
  const store = await cookies();
  store.set(SESSION_COOKIE, signSession(userId), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
}

export async function deleteSessionCookie() {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

// 쿠키 검증 후 Supabase에서 사용자 행을 조회해 { id, email, name, refreshToken }을
// 반환한다. 로그인 안 했거나 세션이 무효/만료됐거나 사용자 행이 없으면 null.
export async function getCurrentUser() {
  const store = await cookies();
  const session = verifySession(store.get(SESSION_COOKIE)?.value);
  if (!session) return null;

  const user = await getUserById(session.userId);
  if (!user) return null;
  return { id: user.id, email: user.email, name: user.name, refreshToken: user.googleRefreshToken };
}
