"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

const TOAST_DURATION_MS = 20000;

export default function DumpPage() {
  const [text, setText] = useState("");
  const [status, setStatus] = useState("idle"); // idle | loading | error | done
  const [errorMessage, setErrorMessage] = useState("");
  const [warning, setWarning] = useState(null);
  const [toastLines, setToastLines] = useState(null);
  const toastTimerRef = useRef(null);

  useEffect(() => {
    return () => clearTimeout(toastTimerRef.current);
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!text.trim()) return;

    setStatus("loading");
    setErrorMessage("");
    setWarning(null);

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
      setStatus("done");
      setWarning(
        data.uncertain
          ? data.reason || "AI가 일부 항목의 배치를 확신하지 못했습니다."
          : null
      );

      if (data.summary?.length > 0) {
        clearTimeout(toastTimerRef.current);
        setToastLines(data.summary);
        toastTimerRef.current = setTimeout(() => setToastLines(null), TOAST_DURATION_MS);
      }
    } catch (err) {
      setErrorMessage(err.message);
      setStatus("error");
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 px-6 py-16">
      <h1 className="text-xl font-semibold text-zinc-900">Dump</h1>
      <p className="text-sm text-zinc-600">
        생각나는 할 일을 자유롭게 적어주세요. 예: &quot;다음주 화요일 영어숙제 마감&quot;
      </p>

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
          disabled={status === "loading"}
          className="self-start rounded-full bg-zinc-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50"
        >
          {status === "loading" ? "AI가 분석 중..." : "제출"}
        </button>
      </form>

      {status === "error" && (
        <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
          {errorMessage}
        </p>
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
