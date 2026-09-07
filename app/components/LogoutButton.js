"use client";

export default function LogoutButton() {
  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }

  return (
    <button onClick={handleLogout} className="text-zinc-500 hover:text-zinc-700">
      로그아웃
    </button>
  );
}
