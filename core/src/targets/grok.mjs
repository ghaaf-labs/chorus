import { SUBPROCESS, ACP } from "./driver.mjs";

export const id = "grok";
export const runModes = [ACP, SUBPROCESS];

export function buildInvocation({ mode, prompt, model }) {
  if (mode === ACP) {
    return {
      command: "grok",
      args: ["agent", "stdio"],
      env: model ? { GROK_MODEL: model } : {},
      prompt
    };
  }
  if (mode !== SUBPROCESS) {
    throw new Error(`grok driver does not support mode "${mode}"`);
  }
  const args = [
    "-p",
    prompt,
    "--output-format",
    "json",
    "--no-subagents",
    "--no-plan",
    "--no-memory",
    "--always-approve",
    "--verbatim",
    "--permission-mode",
    "default"
  ];
  if (model) args.push("--model", model);
  return { command: "grok", args, stdin: "" };
}

export function extractAssistant(runResult, mode) {
  if (mode === ACP) {
    return runResult.stdout ?? "";
  }
  if (mode !== SUBPROCESS) throw new Error("unsupported mode");
  return extractAssistantText(runResult.stdout || "");
}

export function extractTokens(runResult, mode) {
  if (mode === ACP) {
    return { input: 0, output: 0, total: 0 };
  }
  if (mode !== SUBPROCESS) throw new Error("unsupported mode");
  return extractTokensFromStdout(runResult.stdout || "");
}

export function extractAssistantText(stdout) {
  const trimmed = stdout.trim();
  if (!trimmed) return "";
  try {
    const obj = JSON.parse(trimmed);
    if (typeof obj.text === "string") return obj.text;
    if (typeof obj.result === "string") return obj.result;
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

export function extractTokensFromStdout(stdout) {
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
