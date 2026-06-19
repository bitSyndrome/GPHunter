import type { ProjectSort } from "@gph/shared";

const TABS: { key: ProjectSort; label: string }[] = [
  { key: "active", label: "🏆 Most Active" },
  { key: "ghost", label: "👻 Most Haunted" },
  { key: "momentum", label: "🔥 Momentum" },
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
          className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
            sort === t.key
              ? "bg-neutral-700 text-white"
              : "text-neutral-400 hover:text-neutral-200"
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
