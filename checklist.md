# ✅ Ghost Project Hunter — 개발 체크리스트

> [plan.md](plan.md) 기준. 방향: Push/Hook · Claude Code 우선 · 다기기 동기화.
> 최우선 제약: **Hook은 Claude 동작을 절대 막지 않는다** (타임아웃 2s · 항상 exit 0 · outbox 큐잉).

---

## 0단계: 스캐폴딩 (0.5일) ✅

- [x] 모노레포 구조 생성 (`/shared`, `/server`, `/cli`, `/web`)
- [x] 루트 워크스페이스 설정 (npm workspaces)
- [x] 공통 이벤트 스키마 정의 (zod) — `POST /events` 페이로드 단일 소스
- [x] 공통 타입 패키지/디렉토리 (`@gph/shared`) + 순수 계산 로직 + 테스트 9건 통과
- [x] Prettier / tsconfig 공통 설정 (`tsconfig.base.json`)
- [x] `.gitignore`, README 초안, git init + 첫 커밋

---

## 1단계: 백엔드 + DB (2일) ✅

### DB / 모델
- [x] `better-sqlite3` 셋업 (WAL, FK) + 경로 설정 (`GPH_DB_PATH`)
- [x] 마이그레이션: `users`, `tokens`, `devices`
- [x] 마이그레이션: `projects` (`UNIQUE(user_id, project_key)` → 다기기 병합)
- [x] 마이그레이션: `events` (turns / duration_sec / files_changed / summary)
- [ ] (옵션, 보류) `daily_activity` 집계 캐시 — 현재 JS 집계로 충분

### 인증
- [x] Bearer 토큰 미들웨어 (`Authorization` → user 매핑, last_used_at 갱신)
- [x] MVP 시드 토큰 (`GPH_SEED_TOKEN`) 자동 생성
- [x] 디바이스 자동 등록 (첫 호출 시 `device_id` upsert, `last_seen_at` 갱신)

### API 엔드포인트
- [x] `POST /api/v1/events` — zod 검증 → project upsert(키 병합) → event append
  - [x] `total_sessions`·`total_turns`·`last_active_at(MAX)` 갱신
  - [x] `maturity_signals` → `maturity_score` 환산 (shared 로직 재사용)
  - [x] 응답: `{ project_id, ghost_tier, ghost_score }`
- [x] `GET /api/v1/projects?sort=ghost|active|momentum&archived=false`
  - [x] `ghost_tier` 계산 (fresh<3 / cooling 3–14 / ghost 14–30 / buried ≥30일)
  - [x] `ghost_score = days × log10(total_turns + 10)` (archived 제외, ghost 탭은 tier≥ghost 필터)
  - [x] `momentum` = 최근 7일 활동 ÷ 자체 피크 7일 윈도우 + pinned 우선 정렬
- [x] `GET /api/v1/projects/:id` — 상세 + 일별 스파크라인 + 최근 요약
- [x] `PATCH /api/v1/projects/:id` — `archived` / `pinned` / `completion_pct` / `name` / `description`
- [x] `GET /api/v1/stats` — 총 프로젝트 / 활성 / 유령 / 무덤 수
- [x] `GET /api/v1/health`

### 검증
- [x] 입력 검증(zod) + 에러 핸들링 (`/events`, `/projects`, patch)
- [x] 핵심 계산 단위 테스트 (shared 9건) + API 통합 테스트 4건 (다기기 병합 포함)
- [x] in-memory DB 라운드트립 검증 통과 / 타입체크 통과 / 서버 부팅 확인
- [x] rate limit — 인메모리 토큰 버킷 (`/events`, 기본 60버스트·1/s, 429+Retry-After, 테스트 통과)
- [x] `.env.example` — 전체 설정 항목 문서화

---

## 2단계: CLI Hook 에이전트 (2일) ✅

### 핵심 동작
- [x] `ghost-hunter-hook`: stdin JSON 파싱 (`session_id`/`transcript_path`/`cwd`/`hook_event_name`)
- [x] 프로젝트 키 생성: **로컬+원격 둘 다 전송** (`key` 원격 우선 + `alt_keys` 로컬)
- [x] 원격 추가 시 별칭 병합 (서버 `project_aliases`) — 기록 보존
- [x] `transcript_path` JSONL 파싱 → assistant 턴 수
- [x] `git status --porcelain` → 변경 파일 수 (WIP 신호)
- [x] maturity 신호 스캔 (README/test/CI/배포설정/tag/version)
- [x] 설정 로드: `~/.config/ghost-hunter/config.json` (서버 URL + 토큰 + deviceId)
- [x] `POST /api/v1/events` 전송 (Bearer)

### 장애 격리 (최우선) ⚠️
- [x] watchdog 타임아웃 1.8s (settings 2s 예산 내) + POST 1.5s abort
- [x] **모든 경로에서 exit 0** (실패 무음, `.catch().finally(exit 0)`)
- [x] 비동기 — git 호출 800ms 타임아웃, Claude 블로킹 금지
- [x] 네트워크 실패 시 `~/.config/ghost-hunter/outbox/` 큐잉
- [x] 다음 실행 시 outbox flush (첫 실패 시 중단해 예산 보호)

### 설치 / UX
- [x] `ghost-hunter init` — 설정 저장 + Claude settings Hook 자동 주입 (idempotent)
- [x] `~/.claude/settings.json` Hook 자동 주입 (`SessionStart`/`SessionEnd`, timeout 2)
- [x] `ghost-hunter login <server> <token>` / `status` / `flush`
- [x] 수동 폴백: `ghost-hunter log "<project>" "<summary>"`
- [x] npm 글로벌 패키지 `bin` 설정 (`ghost-hunter`, `ghost-hunter-hook`) + `dist` emit

### 검증
- [x] CLI 단위 테스트 5건 (식별키/maturity/turns 파싱)
- [x] 서버 병합 테스트 2건 (원격 나중 추가 / 두 프로젝트 병합)
- [x] E2E 스모크: 훅 수집 → 조회 → 오프라인 큐 → flush 합산 통과

---

## 3단계: React 리더보드 (3일) ✅

- [x] Vite + React + Tailwind v4 + TanStack Query 셋업
- [x] 다크 테마 토큰 (`#111214` / `#1e1f20` / accent `#a8c7fa` / ghost `#c2e7ff`)
- [x] 리더보드 3개 정렬 탭: 🏆 Most Active / 👻 Most Haunted / 🔥 Momentum
- [x] 프로젝트 카드/행 컴포넌트
  - [x] 제목 + 한 줄 설명 + 기기 배지(🖥 N)
  - [x] 모멘텀 바 (활성도 0–100%)
  - [x] 성숙도 바 (휴리스틱, 수동 완성도 우선)
  - [x] 유령 게이지 (🔥/🌤/👻/🪦) + 등급별 색상
  - [x] "N일 전" 상대 시간 + 세션/턴/유령점수
- [x] 상세 모달 + 활동 스파크라인 + 최근 요약
- [x] 액션: 아카이브 / 핀 고정 / 완성도 수동 입력·초기화
- [x] `buried` 카드 흐림 처리 (opacity)
- [x] 데이터 폴링 (15s) + 토큰 게이트(localStorage)
- [x] 검증: 빌드 통과(97 모듈) + 4개 등급 시드로 3개 정렬 모드 정확성 확인
- [ ] 폴더 경로 복사 버튼 — 후순위(선택)
- [x] 실제 브라우저 스크린샷 검증 (Playwright/chromium) — active/ghost/detail 3화면 확인
- [x] dev 프로세스 관리 스크립트 (`scripts/dev.sh` start/stop/restart/status/logs)
- [x] 웹 기본 포트 5173 → 5273 변경 (5173 타 서비스 충돌 회피, `WEB_PORT`로 override)
- [x] 순수 셸 에이전트 (`scripts/ghost-hunter.sh`) — Node 없이 curl+git, Node 버전과 config 공유·키 동일
- [x] 셸/Node 클라이언트 remote 키 정규화 일치 검증 (다기기 병합 보장)
- [x] zod 스키마 null 허용(nullish) — 셸 클라이언트의 명시적 null 수용
- [x] 기여도 히트맵 — 각 카드에 최근 30일 GitHub 잔디밭 (일별 턴 기준 5단계), 서버 일별 집계 + 테스트
- [x] `scan` 명령 (Node+셸) — 과거 git 커밋 백필, 벌크 엔드포인트(`/events/bulk`), `scan:<날짜>` 디듀프로 재실행 안전 + 테스트
- [x] Python 에이전트 (`scripts/ghost_hunter.py`) — Windows 포함 크로스플랫폼, 표준 라이브러리만, Node/셸과 config·키 호환 (login/init/hook/log/scan/flush/status) + E2E 검증
- [x] 사이트에서 에이전트 배포 — 서버가 스크립트 호스팅(`/api/v1/agent/*`, `/api/v1/install.sh`, 무인증), Node 단일파일 번들(esbuild `build:agent`), 대시보드 "📥 에이전트 설치" 패널(호스트 자동 채움) + E2E/스크린샷
- [x] Node CLI에 `hook` 서브커맨드 통합 + `init`이 절대경로 `node <파일> hook` 주입(PATH 비의존)

---

## 4단계: 다기기 동기화 검증 + 고도화 (2일)

- [x] 두 기기에서 동일 repo 작업 → **단일 프로젝트로 병합** 확인 (서버 테스트 + 혼합 E2E)
- [x] 셸+Node 혼합 클라이언트 E2E (`scripts/e2e-mixed.sh`): 같은 remote·다른 경로 → 1 프로젝트, device_count=2, turns 합산 ✅
- [x] remote 없는 로컬 프로젝트는 `local:host:path`로 기기별 분리 (셸/Node 스모크에서 확인)
- [x] rate limit (인메모리 토큰 버킷) + `.env.example`
- [x] 외부(LAN) 접속: api·web `0.0.0.0` 바인딩 + status에 LAN 주소
- [x] 최종 README 사용 가이드 (CLI/셸/서버관리/외부접속)
- [ ] 아카이브 / 완성도 수동 보정 — UI에 구현됨, 자동 E2E는 미작성(수동 확인 가능)
- [ ] 실제 Claude Code 세션으로 Hook → 대시보드 반영 (사용자 환경에서 `ghost-hunter init` 후 확인)
- [ ] 배포: 공유 서버 + 영속 볼륨, HTTPS, 토큰 회전 — **보류**(사용자 요청)

---

## 🔮 2차 (Post-MVP)
- [ ] 토큰 대시보드 발급 UX (시드 토큰 대체)
- [ ] transcript AI 1줄 요약 (비용 검토)
- [ ] 로컬 프로젝트 수동 병합 기능
- [ ] Gemini CLI 어댑터
- [ ] 팀/협업 공유, 모바일 뷰

---

## 🚦 마일스톤 게이트
- [x] **M1** — curl로 이벤트 적재 + 리더보드 조회 동작 (1단계 끝)
- [x] **M2** — Hook(Node/셸)으로 자동 수집 → E2E 스모크 통과 (2단계 끝)
- [x] **M3** — 대시보드에서 유령 랭킹 시각화 (3단계 끝, 스크린샷 검증)
- [x] **M4** — 다기기 병합 실증 완료 (혼합 E2E). 배포만 보류
