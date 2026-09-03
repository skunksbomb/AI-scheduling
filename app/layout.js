import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
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
};

export default function RootLayout({ children }) {
  return (
    <html
      lang="ko"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-zinc-50">
        <nav className="border-b border-zinc-200 bg-white px-6 py-3 flex gap-6 text-sm font-medium">
          <Link href="/" className="text-zinc-900 hover:text-zinc-600">
            홈
          </Link>
          <Link href="/dump" className="text-zinc-900 hover:text-zinc-600">
            Dump
          </Link>
          <Link href="/matrix" className="text-zinc-900 hover:text-zinc-600">
            아이젠하워 매트릭스
          </Link>
        </nav>
        <main className="flex-1 flex flex-col">{children}</main>
      </body>
    </html>
  );
}
