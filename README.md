# AI Scheduling

개인용 AI 일정 관리 프로그램. Dump 페이지에 할 일을 자연어로 적으면 AI가
아이젠하워 매트릭스에 분류하고, 나중에는 Google Calendar의 빈 시간에 자동
배치합니다.

## 로컬에서 실행하기

1. 의존성 설치 (최초 1회)
   ```
   npm install
   ```
2. `.env.local.example`을 복사해서 `.env.local`을 만들고, [platform.openai.com](https://platform.openai.com)에서
   발급받은 API 키를 `OPENAI_API_KEY`에 채워 넣습니다.
3. 개발 서버 실행
   ```
   npm run dev
   ```
4. 브라우저에서 http://localhost:3000 접속

## Google Calendar 연동 설정 (최초 1회)

1. [Google Cloud Console](https://console.cloud.google.com/)에서 새 프로젝트 생성
2. "API 및 서비스 > 라이브러리"에서 **Google Calendar API**와 **Google Tasks API**를
   각각 검색해서 둘 다 사용 설정
3. "API 및 서비스 > OAuth 동의 화면"에서 User Type을 **외부(External)**로 설정하고
   테스트 사용자로 본인 구글 계정 이메일 추가
4. "API 및 서비스 > 사용자 인증 정보"에서 **OAuth 클라이언트 ID 만들기** →
   애플리케이션 유형은 **데스크톱 앱** 선택
5. 발급된 **클라이언트 ID**와 **클라이언트 보안 비밀**을 `.env.local`의
   `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`에 채워 넣기
6. 아래 명령 실행 → 브라우저가 열리면 구글 계정으로 로그인 및 권한 승인
   ```
   node scripts/google-auth.js
   ```
7. 터미널에 출력되는 refresh token을 `.env.local`의 `GOOGLE_REFRESH_TOKEN`에 붙여넣기

이 과정은 최초 1번만 하면 되고, 이후로는 앱이 자동으로 캘린더에 접근합니다.

## 현재까지 구현된 것

- Dump 페이지 (`/dump`): 텍스트를 적으면 OpenAI API가 할 일/마감일/긴급도/중요도로 구조화
- 아이젠하워 매트릭스 (`/matrix`): 4분면으로 할 일 표시, 완료 체크
- 데이터는 `data/tasks.json` 파일에 임시 저장 (로컬 개발용, 깃허브에는 올라가지 않음)

## 다음 단계 (예정)

1. ~~Google Calendar 연동~~ — 완료. 마감일은 Calendar에 하루종일 '일정'으로,
   실제 할 일은 Google Tasks에 '할 일'로 등록 (하루 최대 4개 분산)
2. ~~미완료 항목 재배치~~ — 완료. 매트릭스 페이지의 "놓친 일정 재배치" 버튼
3. **실제 데이터베이스로 교체** — Vercel은 파일 시스템이 유지되지 않으므로
   배포 전에 `data/tasks.json` 대신 Supabase(무료) 같은 DB로 교체
4. **PWA 설정** — 핸드폰 홈 화면에 설치 가능하도록 manifest 추가
5. **Vercel 배포** — 무료 플랜으로 배포해서 핸드폰 브라우저로 접속

핸드폰 홈 화면 위젯은 별도 개발 없이 Google Calendar 앱의 기본 위젯을 사용합니다
(이 프로그램이 일정을 Google Calendar에 써넣기만 하면 됨).
