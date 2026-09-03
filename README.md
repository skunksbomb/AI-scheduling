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

이 과정은 최초 1번만 하면 되고, 이후로는 앱이 자동으로 캘린더/할 일에 접근합니다.

## Supabase(데이터베이스) 설정 (최초 1회)

Vercel에 배포하면 서버 파일 시스템이 유지되지 않기 때문에, 할 일 목록을
파일이 아니라 실제 데이터베이스에 저장해야 합니다.

1. [supabase.com](https://supabase.com)에서 회원가입 후 새 프로젝트 생성 (무료 플랜,
   DB 비밀번호는 아무거나 설정하고 잘 보관)
2. 프로젝트가 만들어지면 왼쪽 메뉴 **SQL Editor** → 아래 SQL 실행:
   ```sql
   create table tasks (
     id text primary key,
     data jsonb not null,
     created_at timestamptz not null default now()
   );
   ```
3. 왼쪽 메뉴 **Project Settings > API**에서 **Project URL**과
   **service_role** 키(비밀 키, anon 키 아님)를 복사
4. `.env.local`의 `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`에 채워 넣기

service_role 키는 DB 전체 권한을 갖는 비밀 키라 서버 코드(API 라우트)에서만
쓰고 절대 브라우저로 노출하면 안 되는데, 이 프로젝트는 개인용이라 별도
로그인 시스템 없이 서버에서만 이 키로 접근하도록 되어 있습니다.

## 현재까지 구현된 것

- Dump 페이지 (`/dump`): 텍스트를 적으면 OpenAI API가 할 일/마감일/긴급도/중요도로 구조화
- 아이젠하워 매트릭스 (`/matrix`): 4분면으로 할 일 표시, 완료 체크
- 마감은 Google Calendar에 하루종일 '일정'으로, 실제 할 일은 Google Tasks에
  '할 일'로 등록 (하루 최대 4개 분산), 시간 정해진 약속은 '일정'으로 그대로 배치
- "놓친 일정 재배치" 버튼으로 기한 지난 미완료 할 일 재배치
- 데이터는 Supabase에 저장 (Vercel 배포 가능)

## 다음 단계 (예정)

1. ~~Google Calendar / Tasks 연동~~ — 완료
2. ~~미완료 항목 재배치~~ — 완료
3. ~~실제 데이터베이스로 교체~~ — 완료 (Supabase)
4. **PWA 설정** — 핸드폰 홈 화면에 설치 가능하도록 manifest 추가
5. **Vercel 배포** — 무료 플랜으로 배포해서 핸드폰 브라우저로 접속

핸드폰 홈 화면 위젯은 별도 개발 없이 Google Calendar 앱의 기본 위젯을 사용합니다
(이 프로그램이 일정을 Google Calendar에 써넣기만 하면 됨).
