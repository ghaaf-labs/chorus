import { SUBPROCESS, ACP } from "./driver.mjs";

export const id = "copilot";
// GitHub Copilot CLI 1.0.39+ ships native ACP via `copilot acp` and a
// subprocess `copilot chat -p <prompt> --json --allow-all-tools` mode.
export const runModes = [ACP, SUBPROCESS];

export function buildInvocation({ mode, prompt, model }) {
  if (mode === ACP) {
    return {
      command: "copilot",
      args: ["acp"],
      env: model ? { COPILOT_MODEL: model } : {},
      prompt
    };
  }
  if (mode !== SUBPROCESS) {
    throw new Error(`copilot driver does not support mode "${mode}"`);
  }
  const args = ["chat", "-p", prompt, "--json", "--allow-all-tools"];
  if (model) args.push("--model", model);
  return { command: "copilot", args, stdin: "" };
}

export function extractAssistant(runResult, mode) {
  if (mode === ACP) return runResult.stdout ?? "";
  if (mode !== SUBPROCESS) throw new Error("unsupported mode");
  const stdout = (runResult.stdout || "").trim();
  if (!stdout) return "";
  try {
    const obj = JSON.parse(stdout);
    if (typeof obj.response === "string") return obj.response;
    if (typeof obj.message === "string") return obj.message;
    if (typeof obj.content === "string") return obj.content;
    if (typeof obj.text === "string") return obj.text;
  } catch { /* ignore */ }
  return stdout;
}

export function extractTokens(runResult, mode) {
  if (mode === ACP) return { input: 0, output: 0, total: 0 };
  if (mode !== SUBPROCESS) throw new Error("unsupported mode");
  try {
    const obj = JSON.parse((runResult.stdout || "").trim());
    if (obj.usage) {
      const input = obj.usage.input_tokens ?? obj.usage.prompt_tokens ?? 0;
      const output = obj.usage.output_tokens ?? obj.usage.completion_tokens ?? 0;
      return { input, output, total: input + output };
    }
  } catch { /* ignore */ }
  return { input: 0, output: 0, total: 0 };
}
