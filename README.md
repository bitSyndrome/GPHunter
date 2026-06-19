# 👻 Ghost Project Hunter

AI CLI 툴(Claude Code 우선)의 작업 이벤트를 Hook으로 자동 수집하여, 잊혀가는
'유령 프로젝트'를 게임 리더보드로 추적·관리하는 멀티 디바이스 대시보드.

기획: [plan.md](plan.md) · 체크리스트: [checklist.md](checklist.md)

## 구조 (npm workspaces)

| 워크스페이스 | 설명 |
|---|---|
| `shared` (`@gph/shared`) | 이벤트 zod 스키마 + 유령점수/모멘텀/성숙도 순수 로직 (단일 소스) |
| `server` (`@gph/server`) | Express + SQLite API (`/api/v1/...`) |
| `cli` (`ghost-hunter`) | Claude Code Hook 에이전트 + 설치 CLI |
| `web` (`@gph/web`) | React + Vite + Tailwind 리더보드 |

## 개발

```bash
npm install            # 워크스페이스 전체 설치
npm run build:shared   # 공통 패키지 빌드 (다른 패키지가 의존)
npm test               # shared 순수 로직 테스트
```

### 서버 실행/관리 (start/stop/restart)

```bash
npm run start          # api(:8787) + web(:5273) 둘 다 백그라운드 기동
npm run status         # 실행 상태 확인
npm run restart        # 재시작 (포트 충돌 없이 깔끔하게)
npm run stop           # 둘 다 종료
npm run logs api       # api 로그 tail (또는 logs web)
```

개별 제어: `npm run start -- web`, `npm run restart -- api` 등.
환경설정은 루트 `.env`(`PORT`, `WEB_PORT`, `GPH_DB_PATH`, `GPH_SEED_TOKEN`)로.
PID/로그는 `.run/`에 저장됩니다.

> 최우선 제약: **Hook은 Claude 동작을 절대 막지 않는다** (타임아웃 2s · 항상 exit 0 · 실패 시 outbox 큐잉).

## CLI 설치 (개인 사용자)

```bash
npm i -g ghost-hunter                       # (또는 모노레포에서 npm run build -w cli)
ghost-hunter login https://my-server 토큰   # 기기별 서버/토큰 저장
ghost-hunter init                           # ~/.claude/settings.json 에 Hook 자동 주입
ghost-hunter status                         # 설정 + 서버 상태 확인
```

이후 Claude Code 세션을 열고 닫을 때마다 활동이 자동 보고됩니다. 서버가 꺼져
있어도 이벤트는 outbox에 쌓였다가 다음 실행 때 자동 전송됩니다.
수동 기록: `ghost-hunter log "프로젝트명" "작업 요약"`.

### Node 없이 — 순수 셸 버전

Node 글로벌 설치가 부담되면 `curl` + `git`만으로 동작하는 셸 에이전트를 쓸 수
있습니다. 설정 디렉토리(`~/.config/ghost-hunter`)를 Node 버전과 공유하므로
완전히 호환됩니다.

```bash
scripts/ghost-hunter.sh login https://my-server 토큰
scripts/ghost-hunter.sh init      # ~/.claude/settings.json 에 Hook 주입 (jq 권장)
scripts/ghost-hunter.sh status
```

JSON 파싱은 `jq` → `python3` → `sed` 순으로 가용한 것을 사용합니다. 훅은 Node
버전과 동일하게 타임아웃·항상 exit 0·outbox 큐잉으로 Claude를 막지 않습니다.
