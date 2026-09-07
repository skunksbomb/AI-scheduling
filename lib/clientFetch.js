// 클라이언트 컴포넌트에서 API를 부를 때 쓰는 공용 fetch. 로그인이 풀렸으면
// (401) 각 페이지마다 따로 처리하지 않고 여기서 한 번에 /login으로 보낸다.
export async function apiFetch(url, options) {
  const res = await fetch(url, options);
  if (res.status === 401) {
    window.location.href = "/login";
    throw new Error("로그인이 필요합니다.");
  }
  return res;
}
