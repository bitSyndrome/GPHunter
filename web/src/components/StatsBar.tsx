import type { ReactNode } from "react";
import type { Stats } from "@gph/shared";
import { Icon } from "./Icon.tsx";

function Stat({
  value,
  label,
  icon,
  color,
}: {
  value: number;
  label: ReactNode;
  icon?: string;
  color?: string;
}) {
  return (
    <div className="flex flex-col items-center px-4">
      <span className="text-2xl font-semibold" style={{ color }}>
        {value}
      </span>
      <span className="flex items-center gap-1 text-xs text-neutral-400">
        {icon && <Icon name={icon} size={14} style={{ color }} />}
        {label}
      </span>
    </div>
  );
}

export function StatsBar({ stats }: { stats?: Stats }) {
  return (
    <div className="flex items-center justify-center divide-x divide-neutral-800 rounded-xl bg-[var(--color-surface)] py-4">
      <Stat value={stats?.total_projects ?? 0} label="전체" />
      <Stat value={stats?.active ?? 0} icon="local_fire_department" label="활성" color="#7ee787" />
      <Stat value={stats?.ghosts ?? 0} icon="blur_on" label="유령" color="#c2e7ff" />
      <Stat value={stats?.buried ?? 0} icon="block" label="무덤" color="#6b7076" />
    </div>
  );
}
