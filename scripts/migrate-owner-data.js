// 최초 1회만 실행하는 스크립트: 멀티유저 전환 전에 쌓여있던 개인 데이터
// (user_id가 비어있는 tasks/app_state 행)를 새로 로그인해서 생긴 계정에 연결한다.
// 사용법: node scripts/migrate-owner-data.js <owner-user-id>
const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

function loadEnvLocal() {
  const envPath = path.join(__dirname, "..", ".env.local");
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, "utf-8").split(/\r?\n/);
  for (const line of lines) {
    const match = line.match(/^([A-Z_]+)=(.*)$/);
    if (match) process.env[match[1]] = match[2].trim();
  }
}

loadEnvLocal();

const ownerId = process.argv[2];
if (!ownerId) {
  console.error("사용법: node scripts/migrate-owner-data.js <owner-user-id>");
  process.exit(1);
}

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY가 .env.local에 없습니다.");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function main() {
  const { data: user, error: userError } = await supabase
    .from("users")
    .select("id, email")
    .eq("id", ownerId)
    .maybeSingle();
  if (userError) throw userError;
  if (!user) {
    console.error(`users 테이블에 id=${ownerId} 행이 없습니다. 먼저 로그인해주세요.`);
    process.exit(1);
  }

  const { data: tasksRows, error: tasksError } = await supabase
    .from("tasks")
    .update({ user_id: ownerId })
    .is("user_id", null)
    .select("id");
  if (tasksError) throw tasksError;

  const { data: appStateRows, error: appStateError } = await supabase
    .from("app_state")
    .update({ user_id: ownerId })
    .is("user_id", null)
    .select("key");
  if (appStateError) throw appStateError;

  console.log(`계정: ${user.email} (${ownerId})`);
  console.log(`tasks 마이그레이션: ${tasksRows.length}개 행`);
  console.log(`app_state 마이그레이션: ${appStateRows.length}개 행 (${appStateRows.map((r) => r.key).join(", ")})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
