import { useState } from "react";
import type { Project } from "@gph/shared";
import { tierStyle, relativeDays } from "../format.ts";
import { Gauge } from "./Gauge.tsx";
import { Heatmap } from "./Heatmap.tsx";
import { usePatchProject } from "../api.ts";
import { Icon } from "./Icon.tsx";

/** Shell command to jump back into a project ("되살리기"). */
function reviveCommand(project: Project): string {
  return project.path ? `cd "${project.path}" && claude` : "claude";
}

export function ProjectRow({
  rank,
  project,
  onOpen,
}: {
  rank: number;
  project: Project;
  onOpen: () => void;
}) {
  const tier = tierStyle(project.ghost_tier);
  const patch = usePatchProject();
  const [copied, setCopied] = useState(false);
  const maturity = project.completion_pct ?? project.maturity_score;
  const maturityLabel = project.completion_pct != null ? "완성도" : "성숙도";

  // 되살리기: copy the jump-back command; if it was retired, un-retire it too.
  const revive = async () => {
    try {
      await navigator.clipboard.writeText(reviveCommand(project));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — still un-retire below */
    }
    if (project.archived) patch.mutate({ id: project.id, patch: { archived: false } });
  };

  // 보내주기: lay the project to rest with a one-line epitaph.
  const retire = () => {
    const note = window.prompt("회고 한 줄 (묘비명):", project.epitaph ?? "");
    if (note === null) return; // cancelled
    patch.mutate({
      id: project.id,
      patch: { archived: true, epitaph: note.trim() || null },
    });
  };

  return (
    <div
      className={`group rounded-lg border border-neutral-800 bg-[var(--color-surface)] px-3.5 py-2 transition-colors hover:border-neutral-700 ${
        tier.dim ? "opacity-60 hover:opacity-100" : ""
      }`}
    >
      <div className="flex items-center gap-3.5">
        {/* Rank */}
        <div className="w-5 shrink-0 text-center text-sm font-bold tabular-nums text-neutral-600">
          {rank}
        </div>

        {/* Name (+ device badge / description) */}
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <button
            onClick={onOpen}
            className="min-w-0 truncate text-left text-sm font-semibold text-neutral-100 hover:text-[var(--color-accent)]"
            title={project.project_key}
          >
            {project.name}
          </button>
          {project.device_count > 1 && (
            <span className="flex shrink-0 items-center gap-1 rounded bg-neutral-800 px-1.5 py-0.5 text-[10px] text-neutral-400">
              <Icon name="devices" size={12} />
              {project.device_count}
            </span>
          )}
          {project.description && (
            <span className="hidden min-w-0 truncate text-xs text-neutral-600 lg:inline">
              {project.description}
            </span>
          )}
        </div>
        {/* Stats */}
        <div className="mt-1 text-center text-[11px] tabular-nums text-neutral-500">
          {project.total_sessions} 세션 · {project.total_turns} 턴 · 유령점수{" "}
          {project.ghost_score}
        </div>

        {/* Gauges */}
        <div className="hidden w-36 shrink-0 flex-col gap-1.5 sm:flex">
          <Gauge
            label="모멘텀"
            value={project.momentum}
            color="var(--color-accent)"
          />
          <Gauge label={maturityLabel} value={maturity} color="#8b95a1" />
        </div>

        {/* 30-day activity heatmap grid */}
        <div className="hidden w-28 shrink-0 md:block">
          <Heatmap data={project.heatmap} />
        </div>

        {/* Right column: actions on top, tier + last-active below */}
        <div className="flex shrink-0 flex-col items-end gap-1">
          <div className="flex gap-0.5">
            <button
              title={project.pinned ? "고정 해제" : "고정"}
              onClick={() =>
                patch.mutate({ id: project.id, patch: { pinned: !project.pinned } })
              }
              className={`flex rounded p-0.5 transition-colors hover:bg-neutral-800 ${
                project.pinned
                  ? "text-[var(--color-accent)]"
                  : "text-neutral-600 hover:text-neutral-300"
              }`}
            >
              <Icon name="push_pin" filled={project.pinned} size={14} />
            </button>
            <button
              title={copied ? "명령 복사됨!" : "되살리기 (이어서 작업 명령 복사)"}
              onClick={revive}
              className={`flex rounded p-0.5 transition-colors hover:bg-neutral-800 ${
                copied
                  ? "text-emerald-400"
                  : "text-neutral-600 hover:text-neutral-300"
              }`}
            >
              <Icon name={copied ? "check" : "replay"} size={14} />
            </button>
            {!project.archived && (
              <button
                title="보내주기 (회고 남기고 안식)"
                onClick={retire}
                className="flex rounded p-0.5 text-neutral-600 transition-colors hover:bg-neutral-800 hover:text-neutral-300"
              >
                <Icon name="waving_hand" size={14} />
              </button>
            )}
          </div>
          <div className="text-right">
            <div
              className="flex items-center justify-end gap-1 text-[11px] font-medium"
              style={{ color: tier.color }}
            >
              <Icon name={tier.icon} size={12} filled />
              {tier.label}
            </div>
            <div className="text-[10px] text-neutral-500">
              {relativeDays(project.days_since_active)}
            </div>
          </div>
        </div>
      </div>

      {project.archived && project.epitaph && (
        <div className="mt-1.5 border-t border-neutral-800 pt-1.5 text-[11px] italic text-neutral-500">
          🪦 {project.epitaph}
        </div>
      )}
    </div>
  );
}
