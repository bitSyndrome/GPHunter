import { useState } from "react";

function CopyBlock({ title, code }: { title: string; code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-neutral-300">{title}</span>
        <button
          className="text-[11px] text-neutral-400 hover:text-[var(--color-accent)]"
          onClick={() => {
            navigator.clipboard?.writeText(code);
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
          }}
        >
          {copied ? "복사됨 ✓" : "복사"}
        </button>
      </div>
      <pre className="overflow-x-auto rounded-lg bg-neutral-900 p-3 text-xs leading-relaxed text-neutral-200">
        {code}
      </pre>
    </div>
  );
}

export function InstallPanel({ onClose }: { onClose: () => void }) {
  const origin = window.location.origin;

  const python = [
    `curl -O ${origin}/api/v1/agent/ghost_hunter.py`,
    `python ghost_hunter.py login ${origin} <토큰>`,
    `python ghost_hunter.py init`,
  ].join("\n");

  const node = [
    `curl -O ${origin}/api/v1/agent/ghost-hunter.cjs`,
    `node ghost-hunter.cjs login ${origin} <토큰>`,
    `node ghost-hunter.cjs init`,
  ].join("\n");

  const globalInstall = [
    `curl -fsSL ${origin}/api/v1/install.sh | sh`,
    `ghost-hunter login ${origin} <토큰>`,
    `ghost-hunter init`,
  ].join("\n");

  const shell = `curl -fsSL ${origin}/api/v1/install.sh | sh`;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl rounded-2xl border border-neutral-800 bg-[var(--color-surface)] p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-lg font-semibold text-neutral-100">
              에이전트 설치
            </h2>
            <p className="mt-1 text-xs text-neutral-500">
              작업하는 PC에서 아래 중 하나를 실행하세요. `&lt;토큰&gt;`은 서버의 API
              토큰입니다. 세 방식 모두 호환됩니다.
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-neutral-500 hover:text-neutral-200"
          >
            ✕
          </button>
        </div>

        <div className="mt-4 flex flex-col gap-4">
          <CopyBlock
            title="🚀 전역 설치 (PATH 등록, 권장 · macOS/Linux)"
            code={globalInstall}
          />
          <CopyBlock title="🐍 Python (Windows 포함)" code={python} />
          <CopyBlock title="⬢ Node (단일 파일, 수동)" code={node} />
          <CopyBlock title="🐚 셸 부트스트랩만" code={shell} />
        </div>

        <p className="mt-4 text-[11px] text-neutral-600">
          전역 설치는 `~/.local/bin/ghost-hunter`에 깔립니다. Python으로 깔려면
          `| AGENT=py sh`, 설치 위치 변경은 `| BIN=/usr/local/bin sh`. 설치 후 새
          Claude Code 세션마다 자동 수집되고, 기존 저장소는 `ghost-hunter scan`으로
          과거 커밋을 채울 수 있습니다.
        </p>
      </div>
    </div>
  );
}
