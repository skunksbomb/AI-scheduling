// 최초 1회만 실행하는 스크립트: Google 계정 권한을 승인받아 refresh token을 발급받습니다.
// 사용법: node scripts/google-auth.js
// 실행 전 .env.local에 GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET이 채워져 있어야 합니다.

const fs = require("fs");
const path = require("path");
const http = require("http");
const { exec } = require("child_process");
const { google } = require("googleapis");

function loadEnvLocal() {
  const envPath = path.join(__dirname, "..", ".env.local");
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, "utf-8").split(/\r?\n/);
  for (const line of lines) {
    const match = line.match(/^([A-Z_]+)=(.*)$/);
    if (match) process.env[match[1]] = match[2].trim();
  }
}

loadEnvLocal();

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error(
    "GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET이 .env.local에 없습니다. 먼저 채워주세요."
  );
  process.exit(1);
}

const PORT = 4321;
const REDIRECT_URI = `http://localhost:${PORT}`;

const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

const authUrl = oauth2Client.generateAuthUrl({
  access_type: "offline",
  prompt: "consent",
  scope: [
    "https://www.googleapis.com/auth/calendar",
    "https://www.googleapis.com/auth/tasks",
  ],
});

const server = http.createServer(async (req, res) => {
  if (!req.url.startsWith("/?code=") && !req.url.startsWith("/?")) return;

  const url = new URL(req.url, REDIRECT_URI);
  const code = url.searchParams.get("code");

  if (!code) {
    res.end("code가 없습니다. 창을 닫고 터미널을 확인하세요.");
    return;
  }

  res.end("인증 완료! 이 창은 닫으셔도 됩니다. 터미널로 돌아가세요.");
  server.close();

  const { tokens } = await oauth2Client.getToken(code);
  console.log("\n=== 아래 줄을 .env.local의 GOOGLE_REFRESH_TOKEN= 뒤에 붙여넣으세요 ===\n");
  console.log(tokens.refresh_token);
  console.log("\n=====================================================\n");
  process.exit(0);
});

server.listen(PORT, () => {
  console.log("브라우저가 자동으로 열립니다. 안 열리면 아래 URL을 직접 열어주세요:\n");
  console.log(authUrl, "\n");
  exec(`start "" "${authUrl}"`);
});
