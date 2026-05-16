import fs from "node:fs";
import { loadRoleFile, schemaPath } from "./defaults.mjs";
import { truncateInput, DEFAULTS } from "../budget.mjs";

export function loadSchema(role) {
  const p = schemaPath(role);
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

export function composePrompt({ role, sourceHost, task, inputText, depth, maxDepth }) {
  const roleFile = loadRoleFile(role);
  const schema = loadSchema(role);
  const inputTrunc = inputText ? truncateInput(inputText) : { text: "", truncated: false, original_bytes: 0 };

  const envelope = [
    "<chorus_envelope>",
    `  <role>${role}</role>`,
    `  <source_host>${sourceHost}</source_host>`,
    `  <depth>${depth}</depth>`,
    `  <max_depth>${maxDepth}</max_depth>`,
    "</chorus_envelope>"
  ].join("\n");

  const roleBlock = `<role_system>\n${roleFile.body.trim()}\n</role_system>`;

  const taskBlock = `<task>\n${task}\n</task>`;

  const inputBlock = inputText
    ? `<input${inputTrunc.truncated ? ' truncated="true"' : ""}>\n${inputTrunc.text}\n</input>`
    : "";

  const contract = [
    "<output_contract>",
    "Return JSON that conforms exactly to the supplied schema below.",
    "Do not include any prose outside the JSON object.",
    "Do not wrap the JSON in markdown fences.",
    "Schema:",
    JSON.stringify(schema, null, 2),
    "</output_contract>"
  ].join("\n");

  const prompt = [envelope, roleBlock, taskBlock, inputBlock, contract].filter(Boolean).join("\n\n");

  return {
    prompt,
    schema,
    schemaPath: schemaPath(role),
    inputTruncated: inputTrunc.truncated,
    inputOriginalBytes: inputTrunc.original_bytes
  };
}
