import { createClient } from "@supabase/supabase-js";

// Supabase의 tasks 테이블은 컬럼 id(text) + data(jsonb) 하나만 갖는다.
// 할 일 객체 스키마가 계속 바뀌는 중이라, 컬럼마다 매핑하지 않고 객체를
// 통째로 jsonb에 저장해서 코드 쪽 스키마 변경만으로 반영되게 한다.
function getClient() {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      "Supabase 설정이 없습니다. .env.local의 SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY를 확인하세요."
    );
  }
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
}

export async function getTasks() {
  const supabase = getClient();
  const { data, error } = await supabase
    .from("tasks")
    .select("data")
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data.map((row) => row.data);
}

export async function addTasks(newTasks) {
  const supabase = getClient();
  const rows = newTasks.map((t) => ({ id: t.id, data: t }));
  const { error } = await supabase.from("tasks").insert(rows);
  if (error) throw error;
  return getTasks();
}

export async function deleteTaskRow(id) {
  const supabase = getClient();
  const { error } = await supabase.from("tasks").delete().eq("id", id);
  if (error) throw error;
}

export async function updateTask(id, patch) {
  const supabase = getClient();
  const { data: existing, error: fetchError } = await supabase
    .from("tasks")
    .select("data")
    .eq("id", id)
    .single();
  if (fetchError) throw fetchError;

  const updated = { ...existing.data, ...patch };
  const { error: updateError } = await supabase
    .from("tasks")
    .update({ data: updated })
    .eq("id", id);
  if (updateError) throw updateError;

  return getTasks();
}

// app_state: "마지막 동기화 시각" 같은 앱 전역 설정 하나짜리 key-value 저장.
export async function getAppState(key) {
  const supabase = getClient();
  const { data, error } = await supabase
    .from("app_state")
    .select("value")
    .eq("key", key)
    .maybeSingle();
  if (error) throw error;
  return data?.value ?? null;
}

export async function setAppState(key, value) {
  const supabase = getClient();
  const { error } = await supabase.from("app_state").upsert({ key, value });
  if (error) throw error;
}

const USER_CONTEXT_KEY = "userContext";

// "매주 금요일마다 대전->서울 이동함" 같은 사용자 개인 상황을 문장 목록으로 저장.
// AI가 dump 파싱/배치 판단할 때마다 이걸 같이 읽어서 참고한다.
export async function getUserContext() {
  const lines = await getAppState(USER_CONTEXT_KEY);
  return Array.isArray(lines) ? lines : [];
}

export async function setUserContext(lines) {
  await setAppState(USER_CONTEXT_KEY, lines);
}

export async function appendUserContext(note) {
  const trimmed = note.trim();
  if (!trimmed) return getUserContext();
  const lines = await getUserContext();
  if (lines.includes(trimmed)) return lines; // 완전히 같은 문장이면 중복 저장하지 않는다.
  const updated = [...lines, trimmed];
  await setUserContext(updated);
  return updated;
}
