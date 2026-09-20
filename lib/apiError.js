import { NextResponse } from "next/server";
import { reauthMessageFor } from "@/lib/googleAuth";

// 라우트에서 터진 에러를 "항상 JSON 본문이 있는 응답"으로 바꿔준다.
//
// 이게 없으면 Next는 본문이 비어있는 500을 내려주고, 클라이언트의 res.json()이
// 빈 문자열을 파싱하다 "Unexpected end of JSON input"으로 터진다. 그 파싱 에러
// 문구가 화면에 그대로 뜨는 바람에 진짜 원인(구글 권한 만료/부족)이 완전히
// 가려졌던 적이 있다.
//
// 재로그인해야 풀리는 구글 인증 에러는 401 + code:"reauth"로 내려서, 클라이언트
// (lib/clientFetch.js)가 이유를 붙여 로그인 페이지로 보낼 수 있게 한다.
export function apiErrorResponse(err) {
  const reauth = reauthMessageFor(err);
  if (reauth) {
    return NextResponse.json({ error: reauth, code: "reauth" }, { status: 401 });
  }
  console.error(err);
  return NextResponse.json(
    { error: err?.message ?? "알 수 없는 오류가 발생했습니다." },
    { status: 500 }
  );
}
