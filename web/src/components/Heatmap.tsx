import { heatmapLevel } from "@gph/shared";

// GitHub-style intensity colors (dark theme).
const LEVEL_COLORS = ["#1e1f20", "#0e4429", "#006d32", "#26a641", "#39d353"];

/** Last-N-days contribution grid: columns = weeks, rows = day-of-week. */
export function Heatmap({
  data,
}: {
  data: { day: string; value: number }[];
}) {
  // Chunk oldest→newest into week columns of 7.
  const weeks: { day: string; value: number }[][] = [];
  for (let i = 0; i < data.length; i += 7) weeks.push(data.slice(i, i + 7));

  return (
    <div className="flex gap-[3px]" aria-label="최근 30일 기여도">
      {weeks.map((week, wi) => (
        <div key={wi} className="flex flex-col gap-[3px]">
          {week.map((cell) => (
            <div
              key={cell.day}
              title={`${cell.day}: ${cell.value} 턴`}
              className="h-2.5 w-2.5 rounded-[2px]"
              style={{ backgroundColor: LEVEL_COLORS[heatmapLevel(cell.value)] }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
