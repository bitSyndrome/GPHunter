import { useState } from "react";
import type { ProjectSort } from "@gph/shared";
import { useProjects, useStats, clearToken } from "./api.ts";
import { TokenGate } from "./components/TokenGate.tsx";
import { StatsBar } from "./components/StatsBar.tsx";
import { SortTabs } from "./components/SortTabs.tsx";
import { ProjectRow } from "./components/ProjectRow.tsx";
import { ProjectDetail } from "./components/ProjectDetail.tsx";
import { InstallPanel } from "./components/InstallPanel.tsx";
import { NotificationPanel } from "./components/NotificationPanel.tsx";
import { Icon } from "./components/Icon.tsx";

function Leaderboard() {
  const [sort, setSort] = useState<ProjectSort>("active");
  const [showArchived, setShowArchived] = useState(false);
  const [openId, setOpenId] = useState<number | null>(null);
  const [showInstall, setShowInstall] = useState(false);
  const [showNotify, setShowNotify] = useState(false);
  const { data: projects, isLoading, error } = useProjects(sort, showArchived);
  const { data: stats } = useStats();

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 p-4 sm:p-8">
      <header className="flex items-center justify-between">
        <h1 className="flex items-center gap-2 text-2xl font-semibold text-[var(--color-accent)]">
          <Icon name="radar" />
          Ghost Project Hunter
        </h1>
        <div className="flex items-center gap-3 text-xs">
          <button
            onClick={() => setShowNotify(true)}
            className="flex items-center gap-1.5 rounded-lg bg-neutral-800 px-3 py-1.5 text-neutral-200 hover:bg-neutral-700"
          >
            <Icon name="notifications" size={16} />
            알림 설정
          </button>
          <button
            onClick={() => setShowInstall(true)}
            className="flex items-center gap-1.5 rounded-lg bg-neutral-800 px-3 py-1.5 text-neutral-200 hover:bg-neutral-700"
          >
            <Icon name="download" size={16} />
            에이전트 설치
          </button>
          <button
            onClick={() => {
              clearToken();
              location.reload();
            }}
            className="text-neutral-500 hover:text-neutral-300"
          >
            로그아웃
          </button>
        </div>
      </header>

      <StatsBar stats={stats} />
      <SortTabs sort={sort} onChange={setSort} />

      <label className="flex items-center gap-2 self-end text-xs text-neutral-400">
        <input
          type="checkbox"
          checked={showArchived}
          onChange={(e) => setShowArchived(e.target.checked)}
        />
        아카이브 포함
      </label>

      {error ? (
        <Empty text="불러오기 실패 — 토큰을 확인하세요." />
      ) : isLoading ? (
        <Empty text="불러오는 중…" />
      ) : !projects || projects.length === 0 ? (
        <Empty text="아직 수집된 프로젝트가 없습니다. ghost-hunter init 으로 훅을 설치하세요." />
      ) : (
        <div className="flex flex-col gap-2">
          {projects.map((p, i) => (
            <ProjectRow
              key={p.id}
              rank={i + 1}
              project={p}
              onOpen={() => setOpenId(p.id)}
            />
          ))}
        </div>
      )}

      {openId != null && (
        <ProjectDetail id={openId} onClose={() => setOpenId(null)} />
      )}
      {showInstall && <InstallPanel onClose={() => setShowInstall(false)} />}
      {showNotify && <NotificationPanel onClose={() => setShowNotify(false)} />}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div className="rounded-xl border border-dashed border-neutral-800 p-10 text-center text-sm text-neutral-500">
      {text}
    </div>
  );
}

export default function App() {
  return (
    <TokenGate>
      <Leaderboard />
    </TokenGate>
  );
}
