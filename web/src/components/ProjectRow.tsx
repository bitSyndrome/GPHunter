import type { Project } from "@gph/shared";
import { tierStyle, relativeDays } from "../format.ts";
import { Gauge } from "./Gauge.tsx";
import { Heatmap } from "./Heatmap.tsx";
import { usePatchProject } from "../api.ts";
import { Icon } from "./Icon.tsx";

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
  const maturity = project.completion_pct ?? project.maturity_score;
  const maturityLabel = project.completion_pct != null ? "완성도" : "성숙도";

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
              title={project.archived ? "복원" : "아카이브"}
              onClick={() =>
                patch.mutate({
                  id: project.id,
                  patch: { archived: !project.archived },
                })
              }
              className="flex rounded p-0.5 text-neutral-600 transition-colors hover:bg-neutral-800 hover:text-neutral-300"
            >
              <Icon
                name={project.archived ? "unarchive" : "archive"}
                size={14}
              />
            </button>
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

      
    </div>
  );
}
