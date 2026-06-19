import { heatmapLevel } from "@gph/shared";

// GitHub-style intensity colors (dark theme). Level 0 is a touch lighter than
// the card surface (#1e1f20) so empty days still read as cells.
const LEVEL_COLORS = ["#2c2e31", "#0e4429", "#006d32", "#26a641", "#39d353"];

/** Last-N-days contribution grid: days flow left→right, wrapping into rows. */
export function Heatmap({
  data,
}: {
  data: { day: string; value: number }[];
}) {
  return (
    <div>
      
      <div
        className="grid grid-cols-10 gap-[2px]"
        aria-label="최근 30일 기여도"
      >
        {data.map((cell) => (
          <div
            key={cell.day}
            title={`${cell.day}: ${cell.value} 턴`}
            className="aspect-square rounded-[2px]"
            style={{ backgroundColor: LEVEL_COLORS[heatmapLevel(cell.value)] }}
          />
        ))}
      </div>
    </div>
  );
}
