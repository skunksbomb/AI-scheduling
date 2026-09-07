const ERROR_MESSAGES = {
  invalid_state: "로그인 요청이 만료됐어요. 다시 시도해주세요.",
  no_refresh_token: "구글이 접근 권한을 내려주지 않았어요. 다시 로그인해주세요.",
  unknown: "로그인 중 문제가 발생했어요. 다시 시도해주세요.",
};

export default async function LoginPage({ searchParams }) {
  const { error } = await searchParams;
  const message = error ? ERROR_MESSAGES[error] ?? ERROR_MESSAGES.unknown : null;

  return (
    <div className="mx-auto flex w-full max-w-sm flex-1 flex-col items-center justify-center gap-6 px-6 text-center">
      <div>
        <h1 className="text-xl font-semibold text-zinc-900">AI 일정 관리</h1>
        <p className="mt-2 text-sm text-zinc-500">
          구글 계정으로 로그인하면 본인의 캘린더/할일로 이 앱을 쓸 수 있어요.
        </p>
      </div>
      {message && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{message}</p>}
      <a
        href="/api/auth/login"
        className="rounded-full bg-zinc-900 px-6 py-3 text-sm font-medium text-white hover:bg-zinc-700"
      >
        Google로 로그인
      </a>
    </div>
  );
}
