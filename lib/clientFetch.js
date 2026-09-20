// 클라이언트 컴포넌트에서 API를 부를 때 쓰는 공용 fetch. 로그인이 풀렸으면
// (401) 각 페이지마다 따로 처리하지 않고 여기서 한 번에 /login으로 보낸다.
export async function apiFetch(url, options) {
  const res = await fetch(url, options);
  if (res.status === 401) {
    // 구글 권한이 만료/부족해서 온 401이면 왜 다시 로그인해야 하는지 로그인
    // 화면에서 설명할 수 있게 이유를 같이 넘긴다.
    const code = await readErrorCode(res);
    window.location.href = code ? `/login?error=${code}` : "/login";
    throw new Error("로그인이 필요합니다.");
  }
  return res;
}

// apiFetch + JSON 파싱. 라우트에서 예외가 그대로 터지면 Next는 본문이 비어있는
// 500을 내려주는데, 그때 res.json()을 부르면 "Unexpected end of JSON input" 같은
// 파싱 에러가 그대로 화면에 떠서 진짜 원인을 못 찾는다. 여기서 본문을 먼저
// 문자열로 읽고, JSON이 아니면 상태코드 기반 문구로 바꿔 던진다.
export async function apiJson(url, options) {
  const res = await apiFetch(url, options);
  const text = await res.text();

  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }

  if (data === null) {
    throw new Error(
      res.ok ? "서버 응답을 읽지 못했어요." : `서버에서 오류가 발생했어요 (HTTP ${res.status}).`
    );
  }
  if (!res.ok || data.error) {
    throw new Error(data.error || `서버에서 오류가 발생했어요 (HTTP ${res.status}).`);
  }
  return data;
}

async function readErrorCode(res) {
  try {
    const data = await res.clone().json();
    return typeof data?.code === "string" ? data.code : null;
  } catch {
    return null;
  }
}
