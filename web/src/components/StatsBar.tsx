import type { Stats } from "@gph/shared";

function Stat({ value, label, color }: { value: number; label: string; color?: string }) {
  return (
    <div className="flex flex-col items-center px-4">
      <span className="text-2xl font-semibold" style={{ color }}>
        {value}
      </span>
      <span className="text-xs text-neutral-400">{label}</span>
    </div>
  );
}

export function StatsBar({ stats }: { stats?: Stats }) {
  return (
    <div className="flex items-center justify-center divide-x divide-neutral-800 rounded-xl bg-[var(--color-surface)] py-4">
      <Stat value={stats?.total_projects ?? 0} label="전체" />
      <Stat value={stats?.active ?? 0} label="🔥 활성" color="#7ee787" />
      <Stat value={stats?.ghosts ?? 0} label="👻 유령" color="#c2e7ff" />
      <Stat value={stats?.buried ?? 0} label="🪦 무덤" color="#6b7076" />
    </div>
  );
}
