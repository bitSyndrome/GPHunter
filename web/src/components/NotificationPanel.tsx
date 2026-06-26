import { useState } from "react";
import { detectNotifyKind } from "@gph/shared";
import {
  useNotificationConfig,
  useSaveNotification,
  useDeleteNotification,
  useTestNotification,
} from "../api.ts";
import { Icon } from "./Icon.tsx";

const KIND_META: Record<string, { label: string; icon: string }> = {
  slack: { label: "Slack", icon: "tag" },
  discord: { label: "Discord", icon: "forum" },
};

export function NotificationPanel({ onClose }: { onClose: () => void }) {
  const { data: config, isLoading } = useNotificationConfig();
  const save = useSaveNotification();
  const remove = useDeleteNotification();
  const test = useTestNotification();

  const [url, setUrl] = useState("");
  // Show saved URL once loaded (only set initial value, let user edit freely).
  const [touched, setTouched] = useState(false);
  const effectiveUrl = touched ? url : (config?.webhook_url ?? "");
  const kind = effectiveUrl ? detectNotifyKind(effectiveUrl) : null;
  const meta = kind ? KIND_META[kind] : null;

  const setUrlValue = (v: string) => {
    setTouched(true);
    setUrl(v);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-2xl border border-neutral-800 bg-[var(--color-surface)] p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-lg font-semibold text-neutral-100">알림 설정</h2>
            <p className="mt-1 text-xs text-neutral-500">
              Slack 또는 Discord 웹훅 URL을 붙여넣으면 주간 유령 리포트를 보냅니다.
              채널은 URL로 자동 인식됩니다.
            </p>
          </div>
          <button
            onClick={onClose}
            className="flex text-neutral-500 hover:text-neutral-200"
            aria-label="닫기"
          >
            <Icon name="close" size={20} />
          </button>
        </div>

        {isLoading ? (
          <p className="mt-4 text-sm text-neutral-400">불러오는 중…</p>
        ) : (
          <div className="mt-4 flex flex-col gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-neutral-300">
                웹훅 URL
              </span>
              <input
                type="url"
                value={effectiveUrl}
                onChange={(e) => setUrlValue(e.target.value)}
                placeholder="https://hooks.slack.com/services/…  또는  https://discord.com/api/webhooks/…"
                className="rounded-lg bg-neutral-900 px-3 py-2 text-sm text-neutral-100 outline-none focus:ring-1 focus:ring-[var(--color-accent)]"
              />
            </label>

            {/* Auto-detected channel feedback */}
            {effectiveUrl && (
              <div className="text-xs">
                {meta ? (
                  <span className="flex items-center gap-1.5 text-emerald-400">
                    <Icon name={meta.icon} size={14} />
                    {meta.label} 채널로 인식됨
                  </span>
                ) : (
                  <span className="flex items-center gap-1.5 text-amber-400">
                    <Icon name="warning" size={14} />
                    인식할 수 없는 URL — Slack 또는 Discord 웹훅이어야 합니다.
                  </span>
                )}
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <button
                disabled={!meta || save.isPending}
                onClick={() =>
                  save.mutate(
                    { webhook_url: effectiveUrl, enabled: true },
                    { onSuccess: () => setTouched(false) },
                  )
                }
                className="rounded-lg bg-[var(--color-accent)] px-3 py-1.5 text-sm font-medium text-black hover:opacity-90 disabled:opacity-40"
              >
                {save.isPending ? "저장 중…" : "저장"}
              </button>
              <button
                disabled={!meta || test.isPending}
                onClick={() => test.mutate(effectiveUrl)}
                className="rounded-lg bg-neutral-700 px-3 py-1.5 text-sm text-neutral-100 hover:bg-neutral-600 disabled:opacity-40"
              >
                {test.isPending ? "전송 중…" : "테스트 전송"}
              </button>
              {config && (
                <button
                  disabled={remove.isPending}
                  onClick={() =>
                    remove.mutate(undefined, {
                      onSuccess: () => {
                        setUrl("");
                        setTouched(true);
                      },
                    })
                  }
                  className="ml-auto text-xs text-neutral-500 hover:text-red-400"
                >
                  삭제
                </button>
              )}
            </div>

            {/* Feedback */}
            {save.isSuccess && !save.isPending && (
              <p className="text-xs text-emerald-400">저장됨.</p>
            )}
            {test.isSuccess && (
              <p className="text-xs text-emerald-400">
                테스트 전송 성공 — 채널을 확인하세요.
              </p>
            )}
            {test.isError && (
              <p className="text-xs text-red-400">
                전송 실패: {(test.error as Error).message}
              </p>
            )}
            {save.isError && (
              <p className="text-xs text-red-400">
                저장 실패: {(save.error as Error).message}
              </p>
            )}

            {config?.last_sent_at && (
              <p className="text-[11px] text-neutral-600">
                마지막 전송: {new Date(config.last_sent_at).toLocaleString()}
              </p>
            )}
            <p className="text-[11px] text-neutral-600">
              주간 리포트(활성·유령·무덤 수, 가장 아까운 유령 Top3, 이번 주 가장
              활발)를 7일마다 자동 전송합니다.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
