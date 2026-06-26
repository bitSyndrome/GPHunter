/**
 * Live smoke test for the AI memory-aid LLM client — verifies any
 * OpenAI-compatible provider (Gemini, OpenAI, Claude, Ollama) end-to-end.
 *
 * Usage (Gemini example):
 *   GPH_LLM_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai \
 *   GPH_LLM_MODEL=gemini-2.5-flash \
 *   GPH_LLM_API_KEY=<your-key> \
 *   node --experimental-strip-types scripts/llm-smoke.ts
 */
import { summarizeProject, isLLMEnabled } from "../server/src/llm.ts";

const cfg = {
  baseUrl: process.env.GPH_LLM_BASE_URL ?? "https://api.anthropic.com/v1",
  apiKey: process.env.GPH_LLM_API_KEY || null,
  model: process.env.GPH_LLM_MODEL ?? "claude-haiku-4-5",
};

if (!isLLMEnabled(cfg)) {
  console.error("Set GPH_LLM_API_KEY first.");
  process.exit(1);
}

console.log(`Provider: ${cfg.baseUrl}\nModel: ${cfg.model}\n`);

const result = await summarizeProject(cfg, {
  name: "T-Mi",
  daysSinceActive: 21,
  totalTurns: 134,
  recentSummaries: [
    "Flutter 시험 앱 — 문제 채점 화면까지 구현, 결과 저장 로직 작업 중 중단",
    "로그인/회원가입 붙이고 Firebase 연동 시작",
  ],
});

console.log("summary:  ", result.summary);
console.log("next_step:", result.next_step);
console.log("\n✅ Gemini (or configured provider) path works.");
