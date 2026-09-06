export default function manifest() {
  return {
    name: "AI 일정 관리",
    short_name: "일정관리",
    description: "메모를 던지면 AI가 일정과 할 일로 정리해주는 개인용 스케줄러",
    start_url: "/",
    display: "standalone",
    background_color: "#fafafa",
    theme_color: "#4f46e5",
    icons: [
      { src: "/icon-192", sizes: "192x192", type: "image/png" },
      { src: "/icon-512", sizes: "512x512", type: "image/png" },
      { src: "/icon-512", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
