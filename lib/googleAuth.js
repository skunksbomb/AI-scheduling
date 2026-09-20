import { google } from "googleapis";

// 로그인(각자 계정 연결)에 쓰는 OAuth 클라이언트. Tasks/Calendar API 호출용
// getClient(refreshToken)들과 클라이언트 ID/시크릿은 같지만, 이건 리디렉션
// 콜백 주소가 필요한 "로그인 흐름" 전용이라 따로 둔다.
function buildOAuthClient() {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, APP_BASE_URL } = process.env;
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !APP_BASE_URL) {
    throw new Error(
      "Google 로그인 설정이 없습니다. .env.local의 GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / APP_BASE_URL을 확인하세요."
    );
  }
  return new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, `${APP_BASE_URL}/api/auth/callback`);
}

const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar";
const TASKS_SCOPE = "https://www.googleapis.com/auth/tasks";

export const SCOPES = [
  CALENDAR_SCOPE,
  TASKS_SCOPE,
  "openid",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
];

// 이 둘이 없으면 앱이 할 수 있는 게 사실상 없다. 구글 동의 화면은 항목별
// 체크박스라서 사용자가 캘린더/할일만 끄고 "계속"을 누를 수 있는데, 그래도
// 토큰 자체는 멀쩡하게 발급된다 — 그 토큰을 저장해두면 나중에 모든 API
// 호출이 403(insufficient scopes)으로 터진다. 그래서 로그인 시점에 거른다.
export const REQUIRED_SCOPES = [CALENDAR_SCOPE, TASKS_SCOPE];

// 토큰에 실제로 붙어 나온 scope 문자열(공백 구분)에서 빠진 필수 권한을 찾는다.
export function findMissingScopes(grantedScope) {
  const granted = new Set((grantedScope ?? "").split(" ").filter(Boolean));
  return REQUIRED_SCOPES.filter((scope) => !granted.has(scope));
}

export function buildAuthUrl(state) {
  const client = buildOAuthClient();
  return client.generateAuthUrl({
    access_type: "offline",
    // 7일마다 재로그인해야 하는데, prompt를 매번 강제해야 구글이 매번 새
    // refresh_token을 다시 내려준다 (없으면 재로그인해도 조용히 갱신 안 됨).
    prompt: "consent",
    scope: SCOPES,
    state,
  });
}

export async function exchangeCodeForTokens(code) {
  const client = buildOAuthClient();
  const { tokens } = await client.getToken(code);
  return tokens;
}

export async function fetchGoogleProfile(accessToken) {
  const client = buildOAuthClient();
  client.setCredentials({ access_token: accessToken });
  const oauth2 = google.oauth2({ version: "v2", auth: client });
  const { data } = await oauth2.userinfo.get();
  return { sub: data.id, email: data.email, name: data.name ?? null };
}

export const REAUTH_MESSAGE = "Google 인증이 만료됐어요. 다시 로그인해주세요.";
export const MISSING_SCOPE_MESSAGE =
  "Google 캘린더·할일 접근 권한이 없어요. 다시 로그인하면서 권한을 모두 허용해주세요.";

// 저장해둔 refresh token이 만료(테스트 상태 7일 제한)되거나 사용자가 직접
// 권한을 취소했을 때 구글이 돌려주는 에러. 이걸 감지해서 "다시 로그인해주세요"
// 처럼 명확한 안내를 보여주는 데 쓴다.
export function isInvalidGrantError(err) {
  return err?.response?.data?.error === "invalid_grant";
}

// 토큰 갱신은 되는데 캘린더/할일 권한만 빠져있을 때 각 API가 돌려주는 403.
// (동의 화면에서 해당 체크박스를 끈 채로 로그인한 경우)
export function isInsufficientScopeError(err) {
  const apiError = err?.response?.data?.error;
  if (err?.code !== 403 && apiError?.code !== 403) return false;
  return (
    apiError?.errors?.some((e) => e.reason === "insufficientPermissions") ||
    apiError?.details?.some((d) => d.reason === "ACCESS_TOKEN_SCOPE_INSUFFICIENT") ||
    false
  );
}

// 재로그인으로만 풀리는 구글 인증 에러면 사용자에게 보여줄 안내 문구를,
// 그 외의 에러면 null을 돌려준다.
export function reauthMessageFor(err) {
  if (isInvalidGrantError(err)) return REAUTH_MESSAGE;
  if (isInsufficientScopeError(err)) return MISSING_SCOPE_MESSAGE;
  return null;
}
