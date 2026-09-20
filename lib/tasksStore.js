"use client";

import { createContext, useCallback, useContext, useState } from "react";
import { apiJson } from "@/lib/clientFetch";

// 매트릭스 페이지가 들어갈 때마다 /api/tasks를 다시 불러서, dump에서 확정하고
// 넘어가도 "불러오는 중..."을 한 번 거쳐야 했다. 할 일 목록을 루트 레이아웃
// 아래 하나의 저장소에 담아두면 페이지를 오가도 살아있으므로: dump 확정
// 응답에 들어있는 최신 목록을 여기 넣고, 매트릭스는 그걸 즉시 보여준다.
// 서버에서 다시 가져오는 건 저장소가 비어있을 때(브라우저 새로고침 직후)뿐.
const TasksStoreContext = createContext(null);

export function TasksProvider({ children }) {
  const [tasks, setTasksState] = useState([]);
  const [loaded, setLoaded] = useState(false);

  const setTasks = useCallback((next) => {
    setTasksState(typeof next === "function" ? next : next ?? []);
    setLoaded(true);
  }, []);

  // force: true면 30분 제한을 무시하고 구글 쪽 상태를 지금 바로 확인한다
  // (매트릭스의 "지금 동기화"). 평소 진입은 force 없이 부른다.
  const refresh = useCallback(
    async ({ force = false } = {}) => {
      const data = await apiJson(`/api/tasks${force ? "?force=1" : ""}`);
      setTasks(data.tasks || []);
    },
    [setTasks]
  );

  return (
    <TasksStoreContext.Provider value={{ tasks, loaded, setTasks, refresh }}>{children}</TasksStoreContext.Provider>
  );
}

export function useTasksStore() {
  const ctx = useContext(TasksStoreContext);
  if (!ctx) throw new Error("useTasksStore는 TasksProvider 안에서만 쓸 수 있습니다.");
  return ctx;
}
