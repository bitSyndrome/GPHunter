# 📋 프로젝트 기획서: Ghost Project Hunter (가제)

> **한 줄 요약:** AI CLI 툴(Claude Code 우선)의 작업 이벤트를 Hook으로 자동 수집하여, 잊혀가는 '유령 프로젝트'를 게임 리더보드 형태로 추적·관리하는 멀티 디바이스 대시보드

> **확정된 방향:** ① 수집 = Hook/Wrapper **Push** 방식 · ② 대상 = **Claude Code** 우선 · ③ 범위 = **여러 기기 동기화**(공유 서버 + 토큰 인증)

---

## 1. 프로젝트 개요

* **배경:** AI 어시스턴트(Claude Code 등) 덕분에 프로젝트 생성이 극도로 쉬워졌으나, 그만큼 방치되고 잊히는 '유령 프로젝트'가 급증함.
* **문제 정의:** 여러 기기(노트북/데스크탑)에 흩어진 채, "이 프로젝트 어디까지 했더라?"를 추적할 단일 뷰가 없음.
* **목적:** CLI 작업 이벤트를 자동 수집·동기화하여, **(1) 지금 살아있는 프로젝트**와 **(2) 위험하게 방치된 유령 프로젝트**를 한 화면의 리더보드로 파악.
* **핵심 차별점:** 수동 입력 0 (Hook 자동 수집) + 여러 기기를 하나로 합치는 동기화 + "공들인 만큼 더 아까운 유령" 랭킹.

### 1-1. 범위 (Scope)

* **In:** Claude Code 세션 자동 수집, git 기반 프로젝트 식별, 다기기 동기화, 리더보드/상세 뷰, 수동 보정(아카이브/완성도).
* **Out (MVP 제외):** Gemini/기타 CLI(어댑터로 확장 여지만 남김), 팀/협업 공유, 모바일 앱, 작업 내용 AI 요약 자동 생성(2차).

---

## 2. 핵심 기능 요구사항

### 🔹 1) 데이터 수집 — Claude Code Hook (Push)

Claude Code의 **Hook** 메커니즘을 이용. Hook은 이벤트 발생 시 stdin으로 JSON(`session_id`, `transcript_path`, `cwd`, `hook_event_name` 등)을 받는 외부 명령을 실행할 수 있음.

* **사용 Hook:**
  * `SessionStart` → 프로젝트가 "터치"됨(활성 신호).
  * `SessionEnd` → 세션 종료 시 요약 지표 전송(턴 수, 변경 파일 수, 소요 시간).
* **수집 에이전트:** `ghost-hunter-hook` (Node 기반 글로벌 CLI 패키지). 동작:
  1. stdin JSON 파싱 → `cwd` 확보.
  2. **프로젝트 식별 키 생성** (다기기 동기화 핵심):
     - 1순위: `git remote get-url origin` 정규화 → `github.com/<user>/<repo>` 형태. → 노트북/데스크탑이 **같은 프로젝트로 병합**됨.
     - 2순위(remote 없음): `local:<hostname>:<absolute-path>` (해당 기기 한정).
  3. **지표 수집:** `transcript_path` JSONL을 tail 파싱하여 턴 수 / 마지막 작업 요약 추출, `git diff --stat`으로 변경 파일 수, 프로젝트 성숙도 신호 스캔(아래 2-3).
  4. 설정 파일(`~/.config/ghost-hunter/config.json`)의 서버 URL·토큰으로 `POST /api/v1/events`.
  5. **장애 격리:** 네트워크 실패 시 로컬 outbox(`~/.config/ghost-hunter/outbox/`)에 큐잉 후 다음 실행 때 flush. **어떤 경우에도 비-0 종료/지연으로 Claude를 막지 않음(타임아웃 2s, 항상 exit 0).**
* **설치 UX:** `npx ghost-hunter init` → ① 서버 URL/토큰 입력 ② 디바이스 등록 ③ `~/.claude/settings.json`에 Hook 자동 주입.

```jsonc
// ~/.claude/settings.json (자동 주입 예시)
{
  "hooks": {
    "SessionStart": [{ "hooks": [{ "type": "command", "command": "ghost-hunter-hook", "timeout": 2 }] }],
    "SessionEnd":   [{ "hooks": [{ "type": "command", "command": "ghost-hunter-hook", "timeout": 2 }] }]
  }
}
```

### 🔹 2) 백엔드 API (Node.js)

* **인증(다기기):** `Authorization: Bearer <token>`. 토큰 → user 매핑. 각 기기는 첫 호출 시 `device_id`(UUID) 자동 등록. MVP는 단일 사용자 + 환경변수 시드 토큰으로 시작, 이후 대시보드에서 토큰 발급.
* **엔드포인트:**

| Method | Path | 설명 |
|---|---|---|
| `POST` | `/api/v1/events` | Hook 이벤트 수신 → 프로젝트 upsert + 이벤트 적재 |
| `GET`  | `/api/v1/projects?sort=ghost\|active\|momentum&archived=false` | 리더보드 리스트(계산된 ghost_tier·momentum 포함) |
| `GET`  | `/api/v1/projects/:id` | 상세 + 활동 스파크라인(일별 집계) |
| `PATCH`| `/api/v1/projects/:id` | 수동 보정(`archived`, `pinned`, `completion_pct`, `name`, `description`) |
| `GET`  | `/api/v1/stats` | 요약(총 프로젝트 수, 유령 수, 무덤 수 등) |

* **`POST /api/v1/events` 요청 스키마:**

```jsonc
{
  "device_id": "a1b2-...",
  "hostname": "macbook-pro",
  "event_type": "session_end",          // session_start | session_end
  "session_id": "claude-sess-...",
  "ts": "2026-06-19T09:00:00Z",
  "project": {
    "key": "github.com/wingslee/gphunter",  // 정규화된 식별 키
    "name": "gphunter",
    "path": "/home/wingslee/dev/gphunter",
    "repo_url": "git@github.com:wingslee/gphunter.git",
    "description": "Ghost project tracker"   // README/package.json에서 추출(옵션)
  },
  "metrics": { "turns": 12, "duration_sec": 640, "files_changed": 5 },
  "maturity_signals": { "has_readme": true, "has_tests": false, "has_ci": false, "git_tags": 0, "version": "0.1.0" },
  "summary": "Implemented auth middleware"   // transcript 마지막 작업 요약(옵션)
}
```

* **응답:** `200 { "project_id": 42, "ghost_tier": "fresh", "ghost_score": 0.0 }`
* **데이터베이스:** SQLite (`better-sqlite3`). 단일 사용자/다기기 규모에 충분, 별도 인프라 불필요.

### 🔹 3) 대시보드 (React 웹 프론트엔드)

* **리더보드 3개 정렬 모드(탭):**
  * 🏆 **Most Active** — 최근 7일 활동량(턴 수) 내림차순.
  * 👻 **Most Haunted** — `ghost_score` 내림차순(유령 등급 이상만). *"가장 위험한 유령"*.
  * 🔥 **Momentum** — 활동 추세(상승/하강).
* **카드/행 필수 표시 항목:**
  * **제목 + 한 줄 설명**, 동기화된 기기 배지(노트북/데스크탑 아이콘).
  * **모멘텀 바(활성도):** 최근 7일 활동 ÷ 해당 프로젝트 자체 피크주 활동(0~100%). "완성도"가 아니라 "지금 얼마나 뜨거운가".
  * **성숙도 바(옵션):** maturity 휴리스틱 점수(아래 2-3). 수동 `completion_pct`가 있으면 그 값 우선.
  * **유령 게이지(Ghost Tier):** 마지막 활동 이후 경과 시간 기반 등급(아래 2-2).
  * **마지막 작업:** "3일 전 · auth middleware 구현".
* **액션:** 아카이브(무덤에서 치우기), 핀 고정, 완성도 수동 입력, 프로젝트 폴더 경로 복사.

---

## 2-2. 유령 등급(Ghost Tier) & 유령 점수 공식

`days = now - last_active_at` 기준:

| 등급 | 조건 | 라벨 |
|---|---|---|
| `fresh`  | < 3일   | 🔥 생생함 |
| `cooling`| 3 ~ 14일 | 🌤 식는 중 |
| `ghost`  | 14 ~ 30일 | 👻 유령화 진행 중 |
| `buried` | ≥ 30일  | 🪦 무덤 안착 |

**유령 점수(랭킹용):** 단순 방치일수가 아니라 *투자량*을 가중 → 공들였는데 버려진 프로젝트가 더 위험한 유령으로 상위.

```
ghost_score = days_since_last_active × log10(total_turns + 10)
```

* 예: 50세션 공들이고 30일 방치 > 1세션 만들고 30일 방치. (전자가 "더 아까운 유령")
* 아카이브된 프로젝트는 랭킹에서 제외.

## 2-3. 성숙도(Maturity) 휴리스틱

Hook이 세션 종료 시 `cwd`를 스캔해 신호 수집 → 서버가 0~100 환산. (완성도가 아니라 "프로젝트 골격이 얼마나 갖춰졌나")

| 신호 | 가중치 |
|---|---|
| README 존재 | +20 |
| 테스트 디렉토리/파일 | +25 |
| CI 설정(.github/workflows 등) | +20 |
| 배포 설정(Dockerfile/vercel.json 등) | +15 |
| git tag ≥ 1 | +10 |
| package.json version ≥ 0.1.0 | +10 |

> 사용자가 `completion_pct`를 직접 입력하면 휴리스틱을 덮어씀(수동 우선).

---

## 3. UI/UX 디자인 컨셉

Gemini 인터페이스 톤을 벤치마킹한 '깔끔한 다크 모드 + 게임 한 스푼'.

* **컬러 팔레트:**
  * Background: `#111214` (Deep Charcoal)
  * Surface/Card: `#1e1f20`
  * Accent(Primary): `#a8c7fa` ~ `#d3e3fd` (미스틱 블루)
  * Ghost/Warning: `#c2e7ff`(유령 시안) + 무덤 등급은 저채도 회색 처리(시각적으로 "식음" 표현)
* **레이아웃:** 중앙 정렬 랭킹 리스트(레이싱/RPG 보드 느낌), 1위~N위. 데코 최소화, 타이포 + 게이지 바로 정보 전달.
* **마이크로 인터랙션:** 유령 등급 변화 시 게이지 색 전이, `buried` 진입 시 카드 살짝 흐려짐(👻 → 🪦 시각화).

---

## 4. 아키텍처 및 기술 스택

```
[Claude Code]
   │ Hook(SessionStart/End) → stdin JSON
   ▼
[ghost-hunter-hook (Node CLI)]   ← ~/.config/ghost-hunter/config.json (서버URL+토큰)
   │ 프로젝트키 생성·지표수집·outbox 큐잉
   │ POST /api/v1/events (Bearer token)
   ▼
[Backend: Node + Express, SQLite]  ← 공유 서버(여러 기기가 같은 곳으로 전송)
   │ upsert project / append event / 계산
   ▼
[Frontend: React(Vite) + Tailwind]  ← 리더보드 대시보드
```

* **Frontend:** React (Vite), Tailwind CSS, TanStack Query(데이터 패칭/폴링).
* **Backend:** Node.js (Express), `better-sqlite3`, zod(요청 검증).
* **CLI Agent:** Node 글로벌 패키지 `ghost-hunter` (`init`/`hook`/`login` 서브커맨드).
* **배포(다기기 필수):** 공유 서버가 외부에서 접근 가능해야 함 → Fly.io / Render / 소형 VPS. SQLite 파일은 영속 볼륨에 저장. (로컬 전용이 아니므로 HTTPS + 토큰 인증 필수.)

### 4-1. 데이터 모델 (SQLite)

```sql
-- 사용자/토큰 (MVP: 단일 사용자 시드)
users(id PK, name, created_at)
tokens(token PK, user_id FK, created_at, last_used_at)

-- 기기
devices(id PK, user_id FK, hostname, created_at, last_seen_at)

-- 프로젝트 (user_id + project_key 유니크 → 다기기 병합)
projects(
  id PK, user_id FK,
  project_key UNIQUE-per-user, name, description, repo_url,
  first_seen_at, last_active_at,
  total_sessions, total_turns,
  maturity_score, completion_pct NULLABLE,   -- 수동 우선
  pinned BOOL, archived BOOL
)

-- 이벤트(활동 로그, 스파크라인/모멘텀 산출용)
events(
  id PK, project_id FK, device_id FK,
  event_type, session_id, ts,
  turns, duration_sec, files_changed, summary
)
```

* `ghost_tier`, `ghost_score`, `momentum`은 조회 시 계산(또는 일별 집계 캐시 테이블 `daily_activity`).

---

## 5. 단계별 개발 로드맵 (MVP)

* **0단계: 스캐폴딩 (0.5일)** — 모노레포 구조(`/cli`, `/server`, `/web`), 공통 타입 정의(이벤트 스키마 zod).
* **1단계: 백엔드 + DB (2일)** — 스키마 마이그레이션, `POST /events`(프로젝트 키 병합·upsert), `GET /projects`(ghost/momentum 계산), 토큰 인증·디바이스 등록.
* **2단계: CLI Hook 에이전트 (2일)** — stdin 파싱, git remote 정규화, transcript 턴 카운트, maturity 스캔, outbox 큐잉/flush, `init`로 Hook 자동 주입. *수동 폴백:* `ghost-hunter log "<project>" "<summary>"`.
* **3단계: React 리더보드 (3일)** — 3개 정렬 탭, 카드(모멘텀/성숙도/유령 게이지), 상세 스파크라인, 다크 테마, 폴링.
* **4단계: 다기기 동기화 검증 + 고도화 (2일)** — 두 기기에서 동일 repo 작업 시 단일 프로젝트로 병합 확인, 아카이브/완성도 보정, 배포(HTTPS), 최종 디버깅.

> **총 ~9.5일.** 핵심 리스크는 2단계(Hook 안정성). "Claude를 절대 막지 않는다"를 최우선 제약으로 잡고, 실패 무음·타임아웃·outbox를 1순위로 구현.

---

## 6. 리스크 & 오픈 이슈

| 리스크 | 대응 |
|---|---|
| Hook이 Claude 동작을 지연/차단 | 타임아웃 2s, 항상 exit 0, 비동기 fire-and-forget, outbox 큐잉 |
| git remote 없는 로컬 프로젝트가 기기마다 따로 잡힘 | `local:` 폴백 명시 + 대시보드에서 수동 병합 기능(2차) |
| 공유 서버 노출에 따른 보안 | HTTPS 강제, Bearer 토큰, 토큰 회전, rate limit |
| Claude Code Hook 스펙/transcript 포맷 변경 | 어댑터 레이어로 격리, 핵심 지표(턴 수)만 의존 |
| "완성도"의 모호함 | 측정하지 않음 — 모멘텀+성숙도+수동값으로 분리(2-2/2-3) |

### 결정 필요(2차 논의)
1. 토큰 발급 UX — MVP 시드 토큰 하나 vs 대시보드 발급.
2. transcript 요약 — 마지막 메시지 그대로 vs AI 1줄 요약(비용 발생).
3. Gemini CLI 어댑터 추가 시점.
