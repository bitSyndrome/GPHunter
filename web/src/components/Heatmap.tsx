import { heatmapLevel } from "@gph/shared";

// GitHub-style intensity colors (dark theme).
const LEVEL_COLORS = ["#1e1f20", "#0e4429", "#006d32", "#26a641", "#39d353"];

/** Last-N-days contribution strip: a single horizontal row of day cells. */
export function Heatmap({
  data,
}: {
  data: { day: string; value: number }[];
}) {
  return (
    <div className="flex gap-[3px]" aria-label="최근 30일 기여도">
      {data.map((cell) => (
        <div
          key={cell.day}
          title={`${cell.day}: ${cell.value} 턴`}
          className="h-2.5 flex-1 rounded-[2px]"
          style={{ backgroundColor: LEVEL_COLORS[heatmapLevel(cell.value)] }}
        />
      ))}
    </div>
  );
}
