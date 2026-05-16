import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SUBPROCESS } from "./driver.mjs";

export const id = "opencode";
export const runModes = [SUBPROCESS];

const AGENT_DIR = path.join(os.homedir(), ".config", "opencode", "agent");
const AGENT_NAME = "chorus-buddy";
const AGENT_FILE = path.join(AGENT_DIR, `${AGENT_NAME}.md`);

const AGENT_PROMPT = `---
description: Chorus buddy agent. Reads a Chorus XML envelope and emits role-validated JSON. Do not use directly — Chorus invokes this through "opencode run --agent chorus-buddy".
mode: primary
permission:
  bash: deny
  edit: deny
  write: deny
  webfetch: allow
  websearch: allow
tools:
  bash: false
  edit: false
  write: false
  webfetch: true
  websearch: true
---

You are a Chorus buddy agent. You are being called by another AI agent through the Chorus toolkit to perform one specific role: code review, deep research, architecture proposal, or devil's-advocate critique.

The user message you receive will be a structured XML envelope. Read every block carefully:

- <chorus_envelope> tells you the role, the calling host, and the depth limits.
- <role_system> is your operating manual. Follow it exactly. It defines what to focus on and what to skip.
- <task> is what the caller wants you to do.
- <input> may contain a diff, files, a question, or a plan. Treat it as the canonical context for the task.
- <output_contract> contains a JSON Schema. Your reply MUST be a single JSON object that validates against that schema. No prose outside the JSON. No markdown fences.

You are NOT operating in your usual "coding agent" mode. You are a stateless reviewer/researcher/architect/critic. Do not refuse to emit JSON on form grounds — the JSON IS the deliverable, not arbitrary formatted output.

Do not edit files. Do not run commands. Do not start sub-tasks. Read the envelope, do the role's work, emit the JSON, stop.
`;

function ensureAgentInstalled() {
  if (fs.existsSync(AGENT_FILE) && fs.readFileSync(AGENT_FILE, "utf8") === AGENT_PROMPT) {
    return;
  }
  fs.mkdirSync(AGENT_DIR, { recursive: true });
  fs.writeFileSync(AGENT_FILE, AGENT_PROMPT);
}

export function buildInvocation({ mode, prompt, model }) {
  if (mode !== SUBPROCESS) {
    throw new Error(`opencode driver does not support mode "${mode}"`);
  }
  ensureAgentInstalled();
  const args = [
    "run",
    "--pure",
    "--format",
    "json",
    "--agent",
    AGENT_NAME,
    "--dangerously-skip-permissions"
  ];
  if (model) args.push("--model", model);
  args.push(prompt);
  return { command: "opencode", args, stdin: "" };
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
  let lastText = "";
  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      if (obj.type === "text" && obj.part?.text) {
        lastText = obj.part.text;
      }
    } catch { /* skip non-JSON lines */ }
  }
  return lastText || stdout.trim();
}

export function extractTokensFromStdout(stdout) {
  let input = 0;
  let output = 0;
  for (const line of stdout.split("\n")) {
    if (!line.trim()) continue;
    try {
      const obj = JSON.parse(line);
      if (obj.type === "step_finish" && obj.part?.tokens) {
        input += obj.part.tokens.input ?? 0;
        output += obj.part.tokens.output ?? 0;
      }
    } catch { /* skip non-JSON lines */ }
  }
  return { input, output, total: input + output };
}
