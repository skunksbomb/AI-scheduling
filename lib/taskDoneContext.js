"use client";

import { createContext, useContext, useState } from "react";

// 홈 화면의 "오늘 일정" 체크박스와 "월간 일정" 캘린더는 서로 다른 컴포넌트라
// 하나를 체크해도 다른 쪽은 새로고침 전까진 몰랐다. 구글 Task id를 키로 하는
// 완료 상태 오버라이드를 여기 담아, 두 컴포넌트가 같은 값을 보고 즉시 반영한다.
const TaskDoneContext = createContext(null);

export function TaskDoneProvider({ children }) {
  const [doneOverrides, setDoneOverrides] = useState({});
  const setDone = (id, done) => setDoneOverrides((prev) => ({ ...prev, [id]: done }));

  return <TaskDoneContext.Provider value={{ doneOverrides, setDone }}>{children}</TaskDoneContext.Provider>;
}

export function useTaskDone() {
  return useContext(TaskDoneContext) ?? { doneOverrides: {}, setDone: () => {} };
}
