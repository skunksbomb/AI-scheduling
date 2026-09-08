import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import LogoutButton from "@/app/components/LogoutButton";
import { TasksProvider } from "@/lib/tasksStore";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata = {
  title: "AI Scheduling",
  description: "개인용 AI 일정 관리",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "일정관리",
  },
};

export const viewport = {
  themeColor: "#4f46e5",
  colorScheme: "light",
  viewportFit: "cover",
};

export default async function RootLayout({ children }) {
  const user = await getCurrentUser();

  return (
    <html
      lang="ko"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-zinc-50">
        <nav className="border-b border-zinc-200 bg-white px-4 py-3 flex items-center justify-between gap-2 text-sm font-medium sm:px-6">
          {user && (
            <div className="ml-auto flex items-center gap-3 whitespace-nowrap text-xs text-zinc-500 sm:order-2 sm:ml-0">
              <span className="max-w-[60vw] truncate sm:max-w-none">{user.email}</span>
              <LogoutButton />
            </div>
          )}
          <div className="hidden gap-4 whitespace-nowrap sm:order-1 sm:flex">
            <Link href="/" className="text-zinc-900 hover:text-zinc-600">
              일정
            </Link>
            <Link href="/dump" className="text-zinc-900 hover:text-zinc-600">
              Dump
            </Link>
            <Link href="/matrix" className="text-zinc-900 hover:text-zinc-600">
              아이젠하워 매트릭스
            </Link>
          </div>
        </nav>
        <main className="flex-1 flex flex-col pb-16 sm:pb-0">
          <TasksProvider>{children}</TasksProvider>
        </main>
        <nav
          className="fixed inset-x-0 bottom-0 z-40 flex border-t border-zinc-200 bg-white text-xs font-medium sm:hidden"
          style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        >
          <Link href="/" className="flex-1 py-2.5 text-center text-zinc-900 hover:text-zinc-600">
            일정
          </Link>
          <Link href="/dump" className="flex-1 py-2.5 text-center text-zinc-900 hover:text-zinc-600">
            Dump
          </Link>
          <Link href="/matrix" className="flex-1 py-2.5 text-center text-zinc-900 hover:text-zinc-600">
            매트릭스
          </Link>
        </nav>
      </body>
    </html>
  );
}
