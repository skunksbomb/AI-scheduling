import Link from "next/link";

export default function Home() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 px-6 py-24 text-center">
      <h1 className="text-2xl font-semibold text-zinc-900">AI 스케줄링</h1>
      <p className="max-w-md text-zinc-600">
        Dump 페이지에 할 일을 적으면 AI가 아이젠하워 매트릭스에 분류하고,
        빈 시간에 자동으로 배치해줍니다.
      </p>
      <div className="flex gap-4">
        <Link
          href="/dump"
          className="rounded-full bg-zinc-900 px-5 py-3 text-sm font-medium text-white hover:bg-zinc-700"
        >
          Dump 페이지로 이동
        </Link>
        <Link
          href="/matrix"
          className="rounded-full border border-zinc-300 px-5 py-3 text-sm font-medium text-zinc-900 hover:bg-zinc-100"
        >
          매트릭스 보기
        </Link>
      </div>
    </div>
  );
}
