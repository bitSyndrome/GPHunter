export function Gauge({
  label,
  value,
  color,
  hint,
}: {
  label: string;
  value: number; // 0..100
  color: string;
  hint?: string;
}) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div
      className="flex items-center gap-2 text-xs"
      title={`${label}: ${hint ?? `${Math.round(pct)}%`}`}
    >
      <span className="w-9 shrink-0 text-[11px] text-neutral-400">{label}</span>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-neutral-800">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>
    </div>
  );
}
