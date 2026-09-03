import fs from "fs";
import path from "path";

// 로컬 개발용 임시 저장소입니다. 파일 하나에 할 일 목록을 JSON으로 저장합니다.
// Vercel 배포 시에는 파일 시스템이 유지되지 않으므로, 배포 전에 Supabase 같은
// 실제 데이터베이스로 교체해야 합니다. (README 참고)
const DATA_DIR = path.join(process.cwd(), "data");
const DATA_FILE = path.join(DATA_DIR, "tasks.json");

function ensureFile() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, "[]", "utf-8");
  }
}

export function getTasks() {
  ensureFile();
  const raw = fs.readFileSync(DATA_FILE, "utf-8");
  return JSON.parse(raw);
}

function saveTasks(tasks) {
  ensureFile();
  fs.writeFileSync(DATA_FILE, JSON.stringify(tasks, null, 2), "utf-8");
}

export function addTasks(newTasks) {
  const tasks = getTasks();
  const updated = [...tasks, ...newTasks];
  saveTasks(updated);
  return updated;
}

export function updateTask(id, patch) {
  const tasks = getTasks();
  const updated = tasks.map((t) => (t.id === id ? { ...t, ...patch } : t));
  saveTasks(updated);
  return updated;
}
