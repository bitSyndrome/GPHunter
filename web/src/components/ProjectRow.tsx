import type { Project } from "@gph/shared";
import { tierStyle, relativeDays } from "../format.ts";
import { Gauge } from "./Gauge.tsx";
import { Heatmap } from "./Heatmap.tsx";
import { usePatchProject } from "../api.ts";

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
  const maturityLabel = project.completion_pct != null ? "완성도(수동)" : "성숙도";

  return (
    <div
      className={`group rounded-xl border border-neutral-800 bg-[var(--color-surface)] p-4 transition-all hover:border-neutral-700 ${
        tier.dim ? "opacity-60 hover:opacity-100" : ""
      }`}
    >
      <div className="flex items-center gap-4">
        <div className="w-8 shrink-0 text-center text-lg font-bold text-neutral-500">
          {rank}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <button
              onClick={onOpen}
              className="truncate text-left font-semibold text-neutral-100 hover:text-[var(--color-accent)]"
              title={project.project_key}
            >
              {project.pinned && <span className="mr-1">📌</span>}
              {project.name}
            </button>
            {project.device_count > 1 && (
              <span className="rounded bg-neutral-800 px-1.5 py-0.5 text-[10px] text-neutral-400">
                🖥 {project.device_count}
              </span>
            )}
          </div>
          {project.description && (
            <p className="truncate text-xs text-neutral-500">
              {project.description}
            </p>
          )}
        </div>

        <div className="hidden w-56 shrink-0 flex-col gap-2 sm:flex">
          <Gauge
            label="모멘텀"
            value={project.momentum}
            color="var(--color-accent)"
          />
          <Gauge label={maturityLabel} value={maturity} color="#8b95a1" />
        </div>

        <div className="w-28 shrink-0 text-right">
          <div className="text-sm font-medium" style={{ color: tier.color }}>
            {tier.label}
          </div>
          <div className="text-xs text-neutral-500">
            {relativeDays(project.days_since_active)}
          </div>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between border-t border-neutral-800 pt-2 text-xs text-neutral-500">
        <span>
          {project.total_sessions} 세션 · {project.total_turns} 턴 · 유령점수{" "}
          {project.ghost_score}
        </span>
        <div className="flex gap-3 opacity-0 transition-opacity group-hover:opacity-100">
          <button
            className="hover:text-neutral-200"
            onClick={() =>
              patch.mutate({ id: project.id, patch: { pinned: !project.pinned } })
            }
          >
            {project.pinned ? "고정 해제" : "📌 고정"}
          </button>
          <button
            className="hover:text-neutral-200"
            onClick={() =>
              patch.mutate({
                id: project.id,
                patch: { archived: !project.archived },
              })
            }
          >
            {project.archived ? "복원" : "🗄 아카이브"}
          </button>
        </div>
      </div>

      {/* Contribution heatmap — single full-width row at the very bottom. */}
      <div className="mt-3 flex items-center gap-2">
        <span className="shrink-0 text-[10px] text-neutral-600">최근 30일</span>
        <div className="flex-1">
          <Heatmap data={project.heatmap} />
        </div>
      </div>
    </div>
  );
}
