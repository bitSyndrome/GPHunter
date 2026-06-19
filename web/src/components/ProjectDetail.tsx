import { useState } from "react";
import { useProjectDetail, usePatchProject } from "../api.ts";
import { tierStyle, relativeDays } from "../format.ts";

function Sparkline({ data }: { data: { day: string; turns: number }[] }) {
  if (data.length === 0) {
    return <p className="text-xs text-neutral-600">활동 기록 없음</p>;
  }
  const max = Math.max(...data.map((d) => d.turns), 1);
  return (
    <div className="flex h-16 items-end gap-0.5">
      {data.map((d) => (
        <div
          key={d.day}
          title={`${d.day}: ${d.turns} 턴`}
          className="flex-1 rounded-t bg-[var(--color-accent)]"
          style={{ height: `${(d.turns / max) * 100}%`, minHeight: 2 }}
        />
      ))}
    </div>
  );
}

export function ProjectDetail({
  id,
  onClose,
}: {
  id: number;
  onClose: () => void;
}) {
  const { data, isLoading } = useProjectDetail(id);
  const patch = usePatchProject();
  const [pct, setPct] = useState("");

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-2xl border border-neutral-800 bg-[var(--color-surface)] p-6"
        onClick={(e) => e.stopPropagation()}
      >
        {isLoading || !data ? (
          <p className="text-neutral-400">불러오는 중…</p>
        ) : (
          <>
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-xl font-semibold text-neutral-100">
                  {data.name}
                </h2>
                <p className="text-xs text-neutral-500">{data.project_key}</p>
              </div>
              <button
                onClick={onClose}
                className="text-neutral-500 hover:text-neutral-200"
              >
                ✕
              </button>
            </div>

            <div
              className="mt-3 text-sm font-medium"
              style={{ color: tierStyle(data.ghost_tier).color }}
            >
              {tierStyle(data.ghost_tier).label} ·{" "}
              {relativeDays(data.days_since_active)} 마지막 활동
            </div>

            {data.recent_summary && (
              <p className="mt-2 rounded-lg bg-neutral-900 p-2 text-sm text-neutral-300">
                “{data.recent_summary}”
              </p>
            )}

            <div className="mt-4">
              <div className="mb-1 text-xs text-neutral-400">최근 활동</div>
              <Sparkline data={data.activity} />
            </div>

            <div className="mt-4 grid grid-cols-3 gap-2 text-center text-sm">
              <Metric label="세션" value={data.total_sessions} />
              <Metric label="턴" value={data.total_turns} />
              <Metric label="유령점수" value={data.ghost_score} />
              <Metric label="모멘텀" value={`${data.momentum}%`} />
              <Metric label="성숙도" value={`${data.maturity_score}%`} />
              <Metric label="기기" value={data.device_count} />
            </div>

            <div className="mt-5 flex items-center gap-2 border-t border-neutral-800 pt-4">
              <span className="text-xs text-neutral-400">완성도 수동 설정</span>
              <input
                type="number"
                min={0}
                max={100}
                value={pct}
                placeholder={
                  data.completion_pct != null ? String(data.completion_pct) : "—"
                }
                onChange={(e) => setPct(e.target.value)}
                className="w-20 rounded bg-neutral-900 px-2 py-1 text-sm text-neutral-100"
              />
              <button
                className="rounded bg-neutral-700 px-2 py-1 text-xs text-neutral-100 hover:bg-neutral-600"
                onClick={() =>
                  patch.mutate({
                    id,
                    patch: { completion_pct: pct === "" ? null : Number(pct) },
                  })
                }
              >
                저장
              </button>
              <button
                className="rounded px-2 py-1 text-xs text-neutral-400 hover:text-neutral-200"
                onClick={() =>
                  patch.mutate({ id, patch: { completion_pct: null } })
                }
              >
                초기화(휴리스틱)
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-lg bg-neutral-900 py-2">
      <div className="font-semibold text-neutral-100">{value}</div>
      <div className="text-xs text-neutral-500">{label}</div>
    </div>
  );
}
