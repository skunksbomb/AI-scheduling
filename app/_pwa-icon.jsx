import { ImageResponse } from "next/og";

// PWA 홈 화면 아이콘 모양을 그리는 공용 함수.
// 파일명이 route.js/icon.js 같은 Next.js 규칙과 다르므로 라우트로 취급되지 않는다.
export function renderAppIcon(size) {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(135deg, #4f46e5, #7c3aed)",
        }}
      >
        <div
          style={{
            width: size * 0.62,
            height: size * 0.62,
            background: "white",
            borderRadius: size * 0.12,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
          }}
        >
          <div style={{ height: size * 0.16, background: "#4f46e5", display: "flex" }} />
          <div
            style={{
              flex: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <div
              style={{
                width: size * 0.14,
                height: size * 0.14,
                borderRadius: "50%",
                background: "#7c3aed",
              }}
            />
          </div>
        </div>
      </div>
    ),
    { width: size, height: size }
  );
}
