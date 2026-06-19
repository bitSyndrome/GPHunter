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
    <div className="flex flex-col gap-1">
      <div className="flex justify-between text-xs text-neutral-400">
        <span>{label}</span>
        <span>{hint ?? `${Math.round(pct)}%`}</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-neutral-800">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>
    </div>
  );
}
