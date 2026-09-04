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

   create table app_state (
     key text primary key,
     value jsonb not null
   );
   ```
   (`app_state`는 "마지막으로 Google과 동기화한 시각" 같은 앱 전역 상태 저장용)
3. 왼쪽 메뉴 **Project Settings > API**에서 **Project URL**과
   **service_role** 키(비밀 키, anon 키 아님)를 복사
4. `.env.local`의 `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`에 채워 넣기

service_role 키는 DB 전체 권한을 갖는 비밀 키라 서버 코드(API 라우트)에서만
쓰고 절대 브라우저로 노출하면 안 되는데, 이 프로젝트는 개인용이라 별도
로그인 시스템 없이 서버에서만 이 키로 접근하도록 되어 있습니다.

## 현재까지 구현된 것

### 전체 흐름 (dump 한 번에 일어나는 일)

1. **파싱** (`lib/ai.js` `parseDumpText`) — 자유 텍스트를 GPT가 읽고 항목별로
   `type`(event/task) / `title` / `deadline` / `exact` / `hasTime` / `startTime` /
   `urgent` / `important` / `estimatedMinutes`로 구조화. 날짜는 코드가 만든
   날짜표(요일·[이번주/다음주]·D+N·오늘/내일/모레/글피 라벨)에서 "찾게만" 시켜서
   LLM의 날짜 계산 실수를 막는다.
2. **배치 판단** (`lib/placement.js` `suggestPlacements`) — 실제 Google Calendar
   일정 + 이미 배치된 할 일 + "내 상황"을 GPT에 보여주고, 언제(필요하면 몇 시에)
   할지 판단시킨다. 아이젠하워 사분면별 배치 전략을 프롬프트에 명시
   (특히 "중요&안긴급"은 밀리지 않게 가까운 날의 집중 가능한 시간대 확보).
3. **가드레일** (`lib/placement.js` `applyGuardrails`) — 코드는 "바보 같은 배치"만
   막는다: exact 날짜 강제, 마감일 초과 방지, 과거 시각 제거, 기존 일정과 겹치는
   시간 제거. 몇 시가 적당한지 등은 코드가 재판단하지 않는다.
4. **확인(미리보기)** — 일정이든 할 일이든 **아무것도 즉시 커밋하지 않고**
   "AI가 이렇게 배치하려고 해요" 미리보기를 먼저 보여준다. 각 항목에 AI의 판단
   이유와, 마감 표시(🔔)가 함께 등록된다는 안내도 같이 표시.
5. **확정** (`/api/dump/confirm`) — "전체 확정"을 눌러야 Google Calendar/Tasks와
   Supabase에 실제로 쓴다. "취소"하면 아무 흔적도 남지 않는다.

### 피드백 루프

- 미리보기 화면에서 "AI가 놓친 것"을 적고 **다시 배치**를 누르면
  (`/api/dump/replan`): 원래 dump 문장 + AI의 이전 판단(날짜·이유) + 이번 피드백을
  **다시 통째로** GPT에 넘겨 type/deadline까지 재해석시킨다.
- 그 피드백이 앞으로도 참고할 만한 일반적 습관/제약인지 GPT가 판단해서
  (`lib/ai.js` `distillContextNote`), 그렇다면 깔끔한 문장으로 다듬어 "내 상황"에
  자동 저장한다. 일회성 지시나 상대적 시간 표현("다음주는 바쁨")은 저장하지 않는다.

### 내 상황 (개인 컨텍스트)

- dump 페이지 우상단 "내 상황" 토글에서 직접 보고 편집 (`/api/context`).
- Supabase `app_state` 테이블에 `userContext` 키로 문장 목록 저장.
- 파싱·배치 판단 양쪽 프롬프트에 항상 함께 들어간다. 예: "매주 금요일마다 대전에서
  서울로 올라감"을 적어두면 "다음주 서울 갔을 때 안경집 가기"가 다음주 금요일로
  해석된다.

### 일정 / 할 일 / 마감 표시의 관계

- **일정(event)**: 약속·회의·행사, 그리고 **어딘가에 가는 일**("빵집 가기").
  Google Calendar에만 생성. 시각이 없으면 하루종일 일정.
- **할 일(task)**: 장소 이동 없이 해내는 작업("보고서 작성"). Google Tasks에 등록되고
  Supabase에도 저장돼 아이젠하워 매트릭스(`/matrix`)에 표시.
  - `exact: false` (마감형) — 오늘~마감일 사이에 배치 + 마감일에 `🔔 마감:` 하루종일
    이벤트 생성
  - `exact: true` ("내일 아침에 청소하기") — 그 날짜에 고정 배치, 마감 표시 없음
- Google Tasks API는 시간을 저장하지 못하므로, 제안 시간은 제목 뒤 `(09:00~10:00)`
  텍스트로 붙이고 실제 값은 Supabase에 저장한다.
- **할 일과 마감 표시(🔔)는 서로 독립적이다.** 매트릭스 ✕ 삭제는 할 일만 지우고
  마감 표시는 캘린더에 남긴다. 동기화(`lib/sync.js`)도 한쪽이 지워졌다고 다른 쪽을
  건드리지 않고, 둘 다 없어졌을 때만 Supabase row를 정리한다.
- 홈(`/`)의 **"다가오는 마감"은 캘린더의 `🔔 마감:` 이벤트를 직접 읽는다** —
  "여기 뜬다 ⟺ 마감 이벤트가 존재한다"가 구조적으로 보장되도록.

### 기타

- "놓친 일정 재배치" 버튼(`/matrix`)으로 기한 지난 미완료 할 일을 같은 AI 배치
  로직으로 재배치.
- AI 호출이 실패하면 예전 방식(하루 최대 4개 기계적 분산)으로 자동 폴백.
- 사용 모델은 `OPENAI_PLACEMENT_MODEL`(기본 `gpt-4o`)로 통일. `gpt-4o-mini`는
  "개인 컨텍스트 + 날짜 표현" 같은 복합 판단을 반복적으로 틀려서 교체했다.

## 다음 단계 (예정)

1. ~~Google Calendar / Tasks 연동~~ — 완료
2. ~~미완료 항목 재배치~~ — 완료
3. ~~실제 데이터베이스로 교체~~ — 완료 (Supabase)
4. **PWA 설정** — 핸드폰 홈 화면에 설치 가능하도록 manifest 추가
5. **Vercel 배포** — 무료 플랜으로 배포해서 핸드폰 브라우저로 접속

핸드폰 홈 화면 위젯은 별도 개발 없이 Google Calendar 앱의 기본 위젯을 사용합니다
(이 프로그램이 일정을 Google Calendar에 써넣기만 하면 됨).
