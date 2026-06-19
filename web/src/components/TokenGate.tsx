import { useState, type ReactNode } from "react";
import { getToken, setToken } from "../api.ts";
import { Icon } from "./Icon.tsx";

export function TokenGate({ children }: { children: ReactNode }) {
  const [token, setLocal] = useState(getToken());
  const [ready, setReady] = useState(Boolean(getToken()));

  if (ready) return <>{children}</>;

  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-4 p-8">
      <h1 className="flex items-center gap-2 text-2xl font-semibold text-[var(--color-accent)]">
        <Icon name="radar" />
        Ghost Project Hunter
      </h1>
      <p className="text-sm text-neutral-400">접속 토큰을 입력하세요.</p>
      <div className="flex gap-2">
        <input
          autoFocus
          type="password"
          value={token}
          onChange={(e) => setLocal(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && token.trim()) {
              setToken(token);
              setReady(true);
            }
          }}
          placeholder="API 토큰"
          className="w-64 rounded-lg bg-[var(--color-surface)] px-3 py-2 text-sm text-neutral-100"
        />
        <button
          disabled={!token.trim()}
          onClick={() => {
            setToken(token);
            setReady(true);
          }}
          className="rounded-lg bg-neutral-700 px-4 py-2 text-sm text-neutral-100 hover:bg-neutral-600 disabled:opacity-40"
        >
          접속
        </button>
      </div>
    </div>
  );
}
