"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

const TOAST_DURATION_MS = 20000;

export default function DumpPage() {
  const [text, setText] = useState("");
  const [status, setStatus] = useState("idle"); // idle | loading | draft | confirming | replanning | error | done
  const [errorMessage, setErrorMessage] = useState("");
  const [warning, setWarning] = useState(null);
  const [toastLines, setToastLines] = useState(null);
  const [taskDraft, setTaskDraft] = useState(null);
  const [feedback, setFeedback] = useState("");

  const [contextOpen, setContextOpen] = useState(false);
  const [contextText, setContextText] = useState("");
  const [contextLoading, setContextLoading] = useState(false);
  const [contextSaving, setContextSaving] = useState(false);

  const toastTimerRef = useRef(null);

  useEffect(() => {
    return () => clearTimeout(toastTimerRef.current);
  }, []);

  function showToast(lines) {
    if (!lines || lines.length === 0) return;
    clearTimeout(toastTimerRef.current);
    setToastLines(lines);
    toastTimerRef.current = setTimeout(() => setToastLines(null), TOAST_DURATION_MS);
  }

  async function toggleContext() {
    if (contextOpen) {
      setContextOpen(false);
      return;
    }
    setContextOpen(true);
    setContextLoading(true);
    try {
      const res = await fetch("/api/context");
      const data = await res.json();
      setContextText((data.context || []).join("\n"));
    } finally {
      setContextLoading(false);
    }
  }

  async function handleSaveContext() {
    setContextSaving(true);
    try {
      const res = await fetch("/api/context", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: contextText }),
      });
      const data = await res.json();
      setContextText((data.context || []).join("\n"));
    } finally {
      setContextSaving(false);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!text.trim()) return;

    setStatus("loading");
    setErrorMessage("");
    setWarning(null);
    setTaskDraft(null);
    setFeedback("");

    try {
      const res = await fetch("/api/dump", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "알 수 없는 오류가 발생했습니다.");
      }

      setText("");
      setWarning(
        data.uncertain ? data.reason || "AI가 일부 항목의 배치를 확신하지 못했습니다." : null
      );
      showToast(data.summary);

      if (data.taskDraft) {
        setTaskDraft(data.taskDraft);
        setStatus("draft");
      } else {
        setStatus("done");
      }
    } catch (err) {
      setErrorMessage(err.message);
      setStatus("error");
    }
  }

  async function handleConfirmDraft() {
    if (!taskDraft) return;
    setStatus("confirming");

    try {
      const res = await fetch("/api/dump/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: taskDraft.items, rawText: taskDraft.rawText }),
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "알 수 없는 오류가 발생했습니다.");
      }

      showToast(data.summary);
      setTaskDraft(null);
      setStatus("done");
    } catch (err) {
      setErrorMessage(err.message);
      setStatus("error");
    }
  }

  function handleCancelDraft() {
    // 확정 전엔 Google/Supabase에 아무것도 안 쓰여 있으므로 그냥 버리면 된다.
    setTaskDraft(null);
    setFeedback("");
    setStatus("idle");
  }

  // 확인 화면에서 "AI가 이걸 놓쳤네" 싶은 걸 바로 적으면, 그 피드백을 내 상황에
  // 자동 저장하고 지금 보고 있는 배치를 그 내용을 반영해서 다시 계산한다.
  async function handleReplan() {
    if (!taskDraft) return;
    setStatus("replanning");

    try {
      const res = await fetch("/api/dump/replan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: taskDraft.items, feedback, rawText: taskDraft.rawText }),
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "알 수 없는 오류가 발생했습니다.");
      }

      setTaskDraft({ ...taskDraft, items: data.items, placementFallback: data.placementFallback });
      setFeedback("");
      if (contextOpen) setContextText((data.userContext || []).join("\n"));
      setStatus("draft");
    } catch (err) {
      setErrorMessage(err.message);
      setStatus("error");
    }
  }

  const busy = status === "loading" || status === "confirming" || status === "replanning";

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 px-6 py-16">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-zinc-900">Dump</h1>
        <button
          onClick={toggleContext}
          className="text-xs text-zinc-500 underline hover:text-zinc-700"
        >
          {contextOpen ? "내 상황 닫기" : "내 상황"}
        </button>
      </div>
      <p className="text-sm text-zinc-600">
        생각나는 할 일을 자유롭게 적어주세요. 예: &quot;다음주 화요일 영어숙제 마감&quot;
      </p>

      {contextOpen && (
        <div className="flex flex-col gap-2 rounded-lg border border-zinc-200 bg-zinc-50 p-4">
          <p className="text-xs text-zinc-500">
            평소 반복되는 상황을 적어두면 AI가 배치할 때 참고해요. 한 줄에 하나씩 적어주세요.
            <br />
            예: 매주 금요일마다 대전에서 서울로 이동함
          </p>
          <textarea
            value={contextText}
            onChange={(e) => setContextText(e.target.value)}
            rows={4}
            disabled={contextLoading}
            placeholder="예: 매주 금요일마다 대전에서 서울로 이동함"
            className="w-full rounded-lg border border-zinc-300 bg-white p-3 text-sm text-zinc-900 focus:border-zinc-500 focus:outline-none"
          />
          <button
            onClick={handleSaveContext}
            disabled={contextSaving || contextLoading}
            className="self-start rounded-full border border-zinc-300 px-4 py-2 text-xs font-medium text-zinc-700 hover:bg-zinc-100 disabled:opacity-50"
          >
            {contextSaving ? "저장 중..." : "저장"}
          </button>
        </div>
      )}

      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={8}
          placeholder="여기에 적으세요..."
          className="w-full rounded-lg border border-zinc-300 p-4 text-sm text-zinc-900 focus:border-zinc-500 focus:outline-none"
        />
        <button
          type="submit"
          disabled={busy}
          className="self-start rounded-full bg-zinc-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50"
        >
          {status === "loading" ? "AI가 분석 중..." : "제출"}
        </button>
      </form>

      {status === "error" && (
        <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{errorMessage}</p>
      )}

      {status === "done" && (
        <p className="rounded-lg bg-green-50 p-3 text-sm text-green-700">
          할 일이 매트릭스에 추가되었습니다.{" "}
          <Link href="/matrix" className="underline">
            매트릭스에서 확인하기
          </Link>
        </p>
      )}

      {warning && (
        <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
          ⚠️ {warning} 배치가 부정확할 수 있으니 매트릭스에서 확인해주세요.
        </p>
      )}

      {taskDraft && (
        <div className="flex flex-col gap-3 rounded-lg border border-zinc-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-zinc-700">AI가 이렇게 배치하려고 해요</h2>
          {taskDraft.placementFallback && (
            <p className="text-xs text-amber-700">
              ⚠️ AI 배치 제안에 실패해서 예전 방식(단순 분산)으로 대체했습니다.
            </p>
          )}
          <ul className="flex flex-col gap-1.5 text-sm text-zinc-800">
            {taskDraft.items.map((item, i) => (
              <li key={i} className="flex flex-col">
                <span>{item.displayLine}</span>
                {item.reasoning && <span className="text-xs text-zinc-400">{item.reasoning}</span>}
                {item.warning && <span className="text-xs text-amber-600">{item.warning}</span>}
              </li>
            ))}
          </ul>

          <div className="flex flex-col gap-2 border-t border-zinc-100 pt-3">
            <label className="text-xs text-zinc-500">
              AI가 놓친 게 있으면 적어주세요 (예: &quot;이건 아침엔 하지 마&quot;) — 자동으로
              기억해두고 지금 배치에도 바로 반영해요.
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                placeholder="피드백 입력..."
                className="flex-1 rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-900 focus:border-zinc-500 focus:outline-none"
              />
              <button
                onClick={handleReplan}
                disabled={busy || !feedback.trim()}
                className="shrink-0 rounded-full border border-zinc-300 px-4 py-2 text-xs font-medium text-zinc-700 hover:bg-zinc-100 disabled:opacity-50"
              >
                {status === "replanning" ? "다시 배치 중..." : "다시 배치"}
              </button>
            </div>
          </div>

          <div className="flex gap-2">
            <button
              onClick={handleConfirmDraft}
              disabled={busy}
              className="rounded-full bg-zinc-900 px-4 py-2 text-xs font-medium text-white hover:bg-zinc-700 disabled:opacity-50"
            >
              {status === "confirming" ? "확정 중..." : "전체 확정"}
            </button>
            <button
              onClick={handleCancelDraft}
              disabled={busy}
              className="rounded-full border border-zinc-300 px-4 py-2 text-xs font-medium text-zinc-700 hover:bg-zinc-100 disabled:opacity-50"
            >
              취소
            </button>
          </div>
        </div>
      )}

      {toastLines && (
        <div className="fixed bottom-6 right-6 z-50 flex max-w-sm flex-col gap-1.5 rounded-lg bg-zinc-900 p-4 text-sm text-white shadow-lg">
          {toastLines.map((line, i) => (
            <p key={i}>{line}</p>
          ))}
        </div>
      )}
    </div>
  );
}
