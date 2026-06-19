# ✅ Ghost Project Hunter — 개발 체크리스트

> [plan.md](plan.md) 기준. 방향: Push/Hook · Claude Code 우선 · 다기기 동기화.
> 최우선 제약: **Hook은 Claude 동작을 절대 막지 않는다** (타임아웃 2s · 항상 exit 0 · outbox 큐잉).

---

## 0단계: 스캐폴딩 (0.5일)

- [ ] 모노레포 구조 생성 (`/cli`, `/server`, `/web`)
- [ ] 루트 워크스페이스 설정 (npm/pnpm workspaces)
- [ ] 공통 이벤트 스키마 정의 (zod) — `POST /events` 페이로드 단일 소스
- [ ] 공통 타입 패키지/디렉토리 (`/shared` 또는 `/packages/types`)
- [ ] ESLint / Prettier / tsconfig 공통 설정
- [ ] `.gitignore`, README 초안, git init

---

## 1단계: 백엔드 + DB (2일)

### DB / 모델
- [ ] `better-sqlite3` 셋업 + 영속 경로 설정
- [ ] 마이그레이션: `users`, `tokens`, `devices`
- [ ] 마이그레이션: `projects` (`user_id`+`project_key` 유니크 → 다기기 병합)
- [ ] 마이그레이션: `events` (turns / duration_sec / files_changed / summary)
- [ ] (옵션) `daily_activity` 집계 캐시 테이블

### 인증
- [ ] Bearer 토큰 미들웨어 (`Authorization` → user 매핑)
- [ ] MVP 시드 토큰 (환경변수) 생성
- [ ] 디바이스 자동 등록 (첫 호출 시 `device_id` upsert, `last_seen_at` 갱신)

### API 엔드포인트
- [ ] `POST /api/v1/events` — zod 검증 → project upsert(키 병합) → event append
  - [ ] `project_key` 정규화 검증 / `total_sessions`·`total_turns`·`last_active_at` 갱신
  - [ ] `maturity_signals` → `maturity_score` 환산 (README+20/test+25/CI+20/배포+15/tag+10/version+10)
  - [ ] 응답: `{ project_id, ghost_tier, ghost_score }`
- [ ] `GET /api/v1/projects?sort=ghost|active|momentum&archived=false`
  - [ ] `ghost_tier` 계산 (fresh<3 / cooling 3–14 / ghost 14–30 / buried ≥30일)
  - [ ] `ghost_score = days × log10(total_turns + 10)` (archived 제외)
  - [ ] `momentum` = 최근 7일 활동 ÷ 자체 피크주 활동
- [ ] `GET /api/v1/projects/:id` — 상세 + 일별 스파크라인
- [ ] `PATCH /api/v1/projects/:id` — `archived` / `pinned` / `completion_pct` / `name` / `description`
- [ ] `GET /api/v1/stats` — 총 프로젝트 / 유령 / 무덤 수

### 검증
- [ ] rate limit + 입력 검증(zod) 에러 핸들링
- [ ] 핵심 계산(ghost_score, tier, momentum, maturity) 단위 테스트
- [ ] curl로 `POST /events` → `GET /projects` 왕복 확인

---

## 2단계: CLI Hook 에이전트 (2일)

### 핵심 동작
- [ ] `ghost-hunter-hook`: stdin JSON 파싱 (`session_id`/`transcript_path`/`cwd`/`hook_event_name`)
- [ ] 프로젝트 키 생성: `git remote get-url origin` 정규화 → `github.com/<user>/<repo>`
- [ ] 폴백 키: remote 없으면 `local:<hostname>:<abs-path>`
- [ ] `transcript_path` JSONL tail 파싱 → 턴 수 + 마지막 작업 요약
- [ ] `git diff --stat` → 변경 파일 수
- [ ] maturity 신호 스캔 (README/test/CI/배포설정/tag/version)
- [ ] 설정 로드: `~/.config/ghost-hunter/config.json` (서버 URL + 토큰)
- [ ] `POST /api/v1/events` 전송 (Bearer)

### 장애 격리 (최우선) ⚠️
- [ ] 타임아웃 2s
- [ ] **모든 경로에서 exit 0** (실패 무음)
- [ ] fire-and-forget / 비동기 — Claude 블로킹 금지
- [ ] 네트워크 실패 시 `~/.config/ghost-hunter/outbox/` 큐잉
- [ ] 다음 실행 시 outbox flush

### 설치 / UX
- [ ] `ghost-hunter init` — 서버 URL·토큰 입력 → 디바이스 등록
- [ ] `~/.claude/settings.json` Hook 자동 주입 (`SessionStart`/`SessionEnd`, timeout 2)
- [ ] `ghost-hunter login <server> <token>`
- [ ] 수동 폴백: `ghost-hunter log "<project>" "<summary>"`
- [ ] npm 글로벌 패키지로 배포 가능하게 `bin` 설정

---

## 3단계: React 리더보드 (3일)

- [ ] Vite + React + Tailwind + TanStack Query 셋업
- [ ] 다크 테마 토큰 (`#111214` / `#1e1f20` / accent `#a8c7fa` / ghost `#c2e7ff`)
- [ ] 리더보드 3개 정렬 탭: 🏆 Most Active / 👻 Most Haunted / 🔥 Momentum
- [ ] 프로젝트 카드/행 컴포넌트
  - [ ] 제목 + 한 줄 설명 + 기기 배지(노트북/데스크탑)
  - [ ] 모멘텀 바 (활성도 0–100%)
  - [ ] 성숙도 바 (휴리스틱, 수동값 우선)
  - [ ] 유령 게이지 (🔥/🌤/👻/🪦) + 색 전이
  - [ ] "마지막 작업: N일 전 · 요약"
- [ ] 상세 뷰 + 활동 스파크라인
- [ ] 액션: 아카이브 / 핀 고정 / 완성도 수동 입력 / 폴더 경로 복사
- [ ] `buried` 카드 흐림 처리 등 마이크로 인터랙션
- [ ] 데이터 폴링 (TanStack Query refetch interval)

---

## 4단계: 다기기 동기화 검증 + 고도화 (2일)

- [ ] 두 기기에서 동일 repo 작업 → **단일 프로젝트로 병합** 확인
- [ ] remote 없는 로컬 프로젝트 기기별 분리 동작 확인
- [ ] 아카이브 / 완성도 수동 보정 E2E 확인
- [ ] 배포: 공유 서버 (Fly.io / Render / VPS) + 영속 볼륨(SQLite)
- [ ] HTTPS 강제 + 토큰 회전 + rate limit
- [ ] 실제 Claude Code 세션으로 Hook → 대시보드 반영 E2E
- [ ] 최종 디버깅 / README 사용 가이드

---

## 🔮 2차 (Post-MVP)
- [ ] 토큰 대시보드 발급 UX (시드 토큰 대체)
- [ ] transcript AI 1줄 요약 (비용 검토)
- [ ] 로컬 프로젝트 수동 병합 기능
- [ ] Gemini CLI 어댑터
- [ ] 팀/협업 공유, 모바일 뷰

---

## 🚦 마일스톤 게이트
- [ ] **M1** — curl로 이벤트 적재 + 리더보드 조회 동작 (1단계 끝)
- [ ] **M2** — 실제 Claude 세션이 Hook으로 자동 수집됨 (2단계 끝)
- [ ] **M3** — 대시보드에서 유령 랭킹 시각화 (3단계 끝)
- [ ] **M4** — 다기기 병합 + 배포 완료 (4단계 끝)
