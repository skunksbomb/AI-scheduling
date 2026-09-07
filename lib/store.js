import { createClient } from "@supabase/supabase-js";

// Supabase의 tasks 테이블은 컬럼 id(text) + data(jsonb) + user_id(uuid) 를 갖는다.
// 할 일 객체 스키마가 계속 바뀌는 중이라, 컬럼마다 매핑하지 않고 객체를
// 통째로 jsonb에 저장해서 코드 쪽 스키마 변경만으로 반영되게 한다.
//
// SUPABASE_SERVICE_ROLE_KEY(RLS를 무시하는 키)를 쓰기 때문에, 아래 각 함수의
// .eq("user_id", userId) 필터가 사용자 간 데이터 분리의 유일한 경계다 — DB 자체
// 접근 제한(RLS)은 없다. 이 파일을 고칠 땐 항상 이 필터를 빠뜨리지 않았는지 확인할 것.
function getClient() {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      "Supabase 설정이 없습니다. .env.local의 SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY를 확인하세요."
    );
  }
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
}

export async function getTasks(userId) {
  const supabase = getClient();
  const { data, error } = await supabase
    .from("tasks")
    .select("data")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data.map((row) => row.data);
}

export async function addTasks(userId, newTasks) {
  const supabase = getClient();
  const rows = newTasks.map((t) => ({ id: t.id, user_id: userId, data: t }));
  const { error } = await supabase.from("tasks").insert(rows);
  if (error) throw error;
  return getTasks(userId);
}

export async function deleteTaskRow(userId, id) {
  const supabase = getClient();
  const { error } = await supabase.from("tasks").delete().eq("id", id).eq("user_id", userId);
  if (error) throw error;
}

export async function updateTask(userId, id, patch) {
  const supabase = getClient();
  const { data: existing, error: fetchError } = await supabase
    .from("tasks")
    .select("data")
    .eq("id", id)
    .eq("user_id", userId)
    .single();
  if (fetchError) throw fetchError;

  const updated = { ...existing.data, ...patch };
  const { error: updateError } = await supabase
    .from("tasks")
    .update({ data: updated })
    .eq("id", id)
    .eq("user_id", userId);
  if (updateError) throw updateError;

  return getTasks(userId);
}

// app_state: "마지막 동기화 시각" 같은 사용자별 설정 하나짜리 key-value 저장.
// (user_id, key) 조합이 유니크하다.
export async function getAppState(userId, key) {
  const supabase = getClient();
  const { data, error } = await supabase
    .from("app_state")
    .select("value")
    .eq("user_id", userId)
    .eq("key", key)
    .maybeSingle();
  if (error) throw error;
  return data?.value ?? null;
}

export async function setAppState(userId, key, value) {
  const supabase = getClient();
  const { error } = await supabase
    .from("app_state")
    .upsert({ user_id: userId, key, value }, { onConflict: "user_id,key" });
  if (error) throw error;
}

const USER_CONTEXT_KEY = "userContext";

// "매주 금요일마다 대전->서울 이동함" 같은 사용자 개인 상황을 문장 목록으로 저장.
// AI가 dump 파싱/배치 판단할 때마다 이걸 같이 읽어서 참고한다.
export async function getUserContext(userId) {
  const lines = await getAppState(userId, USER_CONTEXT_KEY);
  return Array.isArray(lines) ? lines : [];
}

export async function setUserContext(userId, lines) {
  await setAppState(userId, USER_CONTEXT_KEY, lines);
}

export async function appendUserContext(userId, note) {
  const trimmed = note.trim();
  if (!trimmed) return getUserContext(userId);
  const lines = await getUserContext(userId);
  if (lines.includes(trimmed)) return lines; // 완전히 같은 문장이면 중복 저장하지 않는다.
  const updated = [...lines, trimmed];
  await setUserContext(userId, updated);
  return updated;
}

function mapUserRow(row) {
  if (!row) return null;
  return { id: row.id, email: row.email, name: row.name, googleRefreshToken: row.google_refresh_token };
}

export async function getUserById(id) {
  const supabase = getClient();
  const { data, error } = await supabase.from("users").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return mapUserRow(data);
}

// 로그인 콜백에서 호출. 같은 구글 계정(google_sub)으로 다시 로그인하면 갱신,
// 처음이면 새로 생성한다. refreshToken이 비어있으면(구글이 이번엔 안 내려준
// 경우) 기존 값을 지우지 않고 그대로 둔다.
export async function upsertUserByGoogleSub({ googleSub, email, name, refreshToken }) {
  const supabase = getClient();
  const { data: existing, error: fetchError } = await supabase
    .from("users")
    .select("*")
    .eq("google_sub", googleSub)
    .maybeSingle();
  if (fetchError) throw fetchError;

  const row = {
    google_sub: googleSub,
    email,
    name,
    google_refresh_token: refreshToken || existing?.google_refresh_token,
    updated_at: new Date().toISOString(),
  };
  if (!row.google_refresh_token) {
    throw new Error("구글이 refresh token을 내려주지 않았습니다. 다시 로그인해주세요.");
  }

  const { data, error } = await supabase
    .from("users")
    .upsert(existing ? { id: existing.id, ...row } : row, { onConflict: "google_sub" })
    .select()
    .single();
  if (error) throw error;
  return mapUserRow(data);
}
