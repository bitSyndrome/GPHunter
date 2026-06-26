import type { ProjectSort } from "@gph/shared";
import { Icon } from "./Icon.tsx";

const TABS: { key: ProjectSort; icon: string; label: string }[] = [
  { key: "active", icon: "trophy", label: "Most Active" },
  { key: "ghost", icon: "blur_on", label: "Most Haunted" },
  { key: "regret", icon: "heart_broken", label: "Most Regrettable" },
  { key: "momentum", icon: "local_fire_department", label: "Momentum" },
];

export function SortTabs({
  sort,
  onChange,
}: {
  sort: ProjectSort;
  onChange: (s: ProjectSort) => void;
}) {
  return (
    <div className="flex gap-1 rounded-xl bg-[var(--color-surface)] p-1">
      {TABS.map((t) => (
        <button
          key={t.key}
          onClick={() => onChange(t.key)}
          className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
            sort === t.key
              ? "bg-neutral-700 text-white"
              : "text-neutral-400 hover:text-neutral-200"
          }`}
        >
          <Icon name={t.icon} size={18} />
          {t.label}
        </button>
      ))}
    </div>
  );
}
