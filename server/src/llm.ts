import type { LLMConfig } from "./config.ts";

/** Whether the AI memory-aid is configured (an API key is present). */
export function isLLMEnabled(cfg: LLMConfig): boolean {
  return cfg.apiKey != null && cfg.apiKey !== "";
}

export interface SummarizeInput {
  name: string;
  daysSinceActive: number;
  totalTurns: number;
  /** Most-recent-first session summaries collected from the project's events. */
  recentSummaries: string[];
}

export interface SummaryResult {
  summary: string; // one line: what this project is + last thing being worked on
  next_step: string; // the most likely next action to resume
}

const SYSTEM_PROMPT =
  "You help a developer remember abandoned side projects so they can decide whether to revive them. " +
  "Given a project's name and its most recent session notes, reply with STRICT JSON " +
  '{"summary": "...", "next_step": "..."} and nothing else. ' +
  "`summary`: one concise sentence — what the project is and the last thing being worked on. " +
  "`next_step`: one concrete action to pick it back up. " +
  "Write both in the same language as the session notes (Korean notes → Korean output). Keep each under 140 characters.";

function buildUserPrompt(input: SummarizeInput): string {
  const notes =
    input.recentSummaries.length > 0
      ? input.recentSummaries.map((s, i) => `${i + 1}. ${s}`).join("\n")
      : "(no session notes recorded)";
  return [
    `Project: ${input.name}`,
    `Idle for ~${Math.round(input.daysSinceActive)} days, ${input.totalTurns} total turns.`,
    "Recent session notes (newest first):",
    notes,
  ].join("\n");
}

/** Pull the first JSON object out of a model reply (handles ```json fences, prose). */
function parseJsonObject(text: string): { summary?: unknown; next_step?: unknown } {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("no JSON object in reply");
  return JSON.parse(text.slice(start, end + 1));
}

/**
 * Summarize a project via the configured OpenAI-compatible chat endpoint.
 * Throws on misconfiguration, network/HTTP errors, or an unparseable reply —
 * the caller maps these to a 502/503 rather than failing silently.
 */
export async function summarizeProject(
  cfg: LLMConfig,
  input: SummarizeInput,
): Promise<SummaryResult> {
  if (!isLLMEnabled(cfg)) throw new Error("LLM not configured");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  let res: Response;
  try {
    res = await fetch(`${cfg.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify({
        model: cfg.model,
        // Generous cap: "thinking" models (e.g. Gemini 2.5, o-series) spend
        // hidden reasoning tokens against this budget before emitting the answer,
        // so a tight limit truncates the JSON. The reply itself stays short.
        max_tokens: 2048,
        temperature: 0.3,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: buildUserPrompt(input) },
        ],
      }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`LLM HTTP ${res.status}: ${body.slice(0, 300)}`);
  }

  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("LLM returned no content");

  const obj = parseJsonObject(content);
  const summary = typeof obj.summary === "string" ? obj.summary.trim() : "";
  const next_step = typeof obj.next_step === "string" ? obj.next_step.trim() : "";
  if (!summary) throw new Error("LLM reply missing summary");
  return { summary, next_step };
}
