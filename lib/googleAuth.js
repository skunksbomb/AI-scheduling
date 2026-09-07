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

export const SCOPES = [
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/tasks",
  "openid",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
];

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

// 저장해둔 refresh token이 만료(테스트 상태 7일 제한)되거나 사용자가 직접
// 권한을 취소했을 때 구글이 돌려주는 에러. 이걸 감지해서 "다시 로그인해주세요"
// 처럼 명확한 안내를 보여주는 데 쓴다.
export function isInvalidGrantError(err) {
  return err?.response?.data?.error === "invalid_grant";
}
