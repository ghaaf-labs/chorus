import fs from "node:fs";
import { SUBPROCESS, ACP } from "./driver.mjs";
import { bridgeAvailable, CLAUDE_ACP_BRIDGE } from "./bridges.mjs";

export const id = "claude-code";
export const runModes = bridgeAvailable(CLAUDE_ACP_BRIDGE) ? [SUBPROCESS, ACP] : [SUBPROCESS];

export function buildInvocation({ mode, prompt, model, schemaPath }) {
  if (mode === ACP) {
    if (!bridgeAvailable(CLAUDE_ACP_BRIDGE)) {
      throw new Error(`claude-code ACP requires the '${CLAUDE_ACP_BRIDGE}' bridge on $PATH`);
    }
    return {
      command: CLAUDE_ACP_BRIDGE,
      args: [],
      env: model ? { ANTHROPIC_MODEL: model } : {},
      prompt
    };
  }
  if (mode !== SUBPROCESS) {
    throw new Error(`claude-code driver does not support mode "${mode}"`);
  }
  const args = ["-p", "--no-session-persistence", "--disable-slash-commands", "--output-format", "json"];
  if (schemaPath) {
    const schemaText = fs.readFileSync(schemaPath, "utf8");
    args.push("--json-schema", schemaText);
  }
  if (model) args.push("--model", model);
  return { command: "claude", args, stdin: prompt };
}

export function extractAssistant(runResult, mode) {
  if (mode === ACP) return runResult.stdout ?? "";
  if (mode !== SUBPROCESS) throw new Error("unsupported mode");
  return extractAssistantText(runResult.stdout || "");
}

export function extractTokens(runResult, mode) {
  if (mode === ACP) return { input: 0, output: 0, total: 0 };
  if (mode !== SUBPROCESS) throw new Error("unsupported mode");
  return extractTokensFromStdout(runResult.stdout || "");
}

export function extractAssistantText(stdout) {
  const trimmed = stdout.trim();
  if (!trimmed) return "";
  try {
    const obj = JSON.parse(trimmed);
    if (typeof obj.result === "string") return obj.result;
    if (typeof obj.response === "string") return obj.response;
    if (Array.isArray(obj.messages)) {
      const last = [...obj.messages].reverse().find((m) => m.role === "assistant");
      if (last) return typeof last.content === "string" ? last.content : JSON.stringify(last.content);
    }
    if (typeof obj.text === "string") return obj.text;
    return trimmed;
  } catch {
    const lines = trimmed.split("\n").filter(Boolean);
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const obj = JSON.parse(lines[i]);
        if (obj.type === "assistant" && typeof obj.text === "string") return obj.text;
        if (typeof obj.result === "string") return obj.result;
      } catch { /* continue */ }
    }
    return trimmed;
  }
}

export function extractTokensFromStdout(stdout) {
  try {
    const obj = JSON.parse(stdout.trim());
    if (obj.usage) {
      const input = obj.usage.input_tokens ?? 0;
      const output = obj.usage.output_tokens ?? 0;
      return { input, output, total: input + output };
    }
  } catch { /* ignore */ }
  return { input: 0, output: 0, total: 0 };
}
