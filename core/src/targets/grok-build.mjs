import { SUBPROCESS, ACP } from "./driver.mjs";

export const id = "grok-build";
// Grok Build (xAI) shipped May 14 2026 with native ACP server: `grok build agent stdio`.
// Subprocess mode mirrors the original grok driver but uses the `build` subcommand.
export const runModes = [ACP, SUBPROCESS];

export function buildInvocation({ mode, prompt, model }) {
  if (mode === ACP) {
    return {
      command: "grok",
      args: ["build", "agent", "stdio"],
      env: model ? { GROK_MODEL: model } : {},
      prompt
    };
  }
  if (mode !== SUBPROCESS) {
    throw new Error(`grok-build driver does not support mode "${mode}"`);
  }
  const args = [
    "build",
    "-p",
    prompt,
    "--output-format",
    "json",
    "--no-plan",
    "--always-approve",
    "--max-subagents",
    "4"
  ];
  if (model) args.push("--model", model);
  return { command: "grok", args, stdin: "" };
}

export function extractAssistant(runResult, mode) {
  if (mode === ACP) return runResult.stdout ?? "";
  if (mode !== SUBPROCESS) throw new Error("unsupported mode");
  const stdout = runResult.stdout || "";
  const trimmed = stdout.trim();
  if (!trimmed) return "";
  try {
    const obj = JSON.parse(trimmed);
    if (typeof obj.text === "string") return obj.text;
    if (typeof obj.result === "string") return obj.result;
    if (typeof obj.message === "string") return obj.message;
  } catch { /* ignore */ }
  const lines = trimmed.split("\n").filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const obj = JSON.parse(lines[i]);
      if (typeof obj.text === "string") return obj.text;
      if (obj.type === "assistant" && typeof obj.message === "string") return obj.message;
    } catch { /* continue */ }
  }
  return trimmed;
}

export function extractTokens(runResult, mode) {
  if (mode === ACP) return { input: 0, output: 0, total: 0 };
  if (mode !== SUBPROCESS) throw new Error("unsupported mode");
  const stdout = runResult.stdout || "";
  try {
    const obj = JSON.parse(stdout.trim());
    if (obj.usage) {
      const input = obj.usage.input_tokens ?? obj.usage.prompt_tokens ?? 0;
      const output = obj.usage.output_tokens ?? obj.usage.completion_tokens ?? 0;
      return { input, output, total: input + output };
    }
  } catch { /* ignore */ }
  return { input: 0, output: 0, total: 0 };
}
