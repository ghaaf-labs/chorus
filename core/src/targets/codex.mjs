import { SUBPROCESS } from "./driver.mjs";

export const id = "codex";
export const runModes = [SUBPROCESS];

export function buildInvocation({ mode, prompt, model, schemaPath, sandbox = "read-only" }) {
  if (mode !== SUBPROCESS) {
    throw new Error(`codex driver does not support mode "${mode}"`);
  }
  const args = ["exec", "--json", "--sandbox", sandbox, "--skip-git-repo-check", "--ephemeral"];
  if (schemaPath) args.push("--output-schema", schemaPath);
  if (model) args.push("--model", model);
  args.push("-");
  return { command: "codex", args, stdin: prompt };
}

export function extractAssistant(runResult, mode) {
  if (mode !== SUBPROCESS) throw new Error("unsupported mode");
  return extractAssistantText(runResult.stdout || "");
}

export function extractTokens(runResult, mode) {
  if (mode !== SUBPROCESS) throw new Error("unsupported mode");
  return extractTokensFromStdout(runResult.stdout || "");
}

export function extractAssistantText(stdout) {
  const lines = stdout.split("\n").filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const obj = JSON.parse(lines[i]);
      if (obj?.type === "item.completed" && obj?.item?.type === "agent_message") {
        const t = obj.item.text ?? obj.item.message;
        if (typeof t === "string") return t;
      }
      const innerType = obj?.msg?.type;
      if (innerType === "agent_message" || innerType === "assistant_message") {
        if (typeof obj.msg.message === "string") return obj.msg.message;
        if (typeof obj.msg.text === "string") return obj.msg.text;
      }
      if (innerType === "task_complete" && typeof obj.msg.last_agent_message === "string") {
        return obj.msg.last_agent_message;
      }
    } catch { /* continue */ }
  }
  return stdout.trim();
}

export function extractTokensFromStdout(stdout) {
  let input = 0;
  let output = 0;
  for (const line of stdout.split("\n")) {
    if (!line.trim()) continue;
    try {
      const obj = JSON.parse(line);
      const u = obj?.usage || obj?.msg?.usage;
      if (u) {
        input += u.input_tokens ?? u.prompt_tokens ?? 0;
        output += u.output_tokens ?? u.completion_tokens ?? 0;
      }
    } catch { /* continue */ }
  }
  return { input, output, total: input + output };
}
