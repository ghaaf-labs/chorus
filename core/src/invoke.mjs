import fs from "node:fs";
import { DEFAULTS } from "./budget.mjs";
import { childEnv, checkGuards, currentDepth, maxDepth } from "./recursion-guard.mjs";
import * as claudeDriver from "./targets/claude.mjs";
import * as codexDriver from "./targets/codex.mjs";
import * as opencodeDriver from "./targets/opencode.mjs";
import * as grokDriver from "./targets/grok.mjs";
import { SUBPROCESS } from "./targets/driver.mjs";
import { runSubprocess } from "./runners/process.mjs";
import { composePrompt } from "./roles/compose.mjs";
import { validateAndTrim } from "./summarize.mjs";
import { generateJobId, JobLogger, newJobLogPath, appendJobIndex } from "./logging.mjs";
import { resolveTarget } from "./roles/defaults.mjs";
import { loadOrRefresh } from "./registry.mjs";
import { estimateCostUsd } from "./pricing.mjs";

const DRIVERS = {
  "claude-code": claudeDriver,
  codex: codexDriver,
  opencode: opencodeDriver,
  grok: grokDriver
};

const ERROR_HINTS = {
  timeout: "Increase --timeout, or check whether the target is hanging.",
  stdout_overflow: "The target emitted more output than CHORUS_STDOUT_MAX_BYTES allows; the target may be misbehaving.",
  schema_violation: "The target's reply did not match the role's JSON schema. Inspect the .payload.json sidecar in ~/.chorus/logs/ for the raw output.",
  spawn_failed: "Could not start the target binary. Run `chorus doctor` to verify it is installed and authed.",
  nonzero_exit: "The target exited non-zero. Check the stderr_excerpt and run `chorus doctor`.",
  no_available_target: "Run `chorus setup` to refresh the capability registry.",
  target_unavailable: "Run `chorus setup` or check the target's auth status.",
  target_not_implemented: "This target is planned for a later milestone. See docs/architecture.md.",
  max_depth_exceeded: "Buddy chain reached CHORUS_MAX_DEPTH. The current call would have recursed too deeply.",
  cycle: "Buddy chain would form a cycle through the same source→target→role edge.",
  self_target: "Source and target are the same; pass --allow-self if this is intentional.",
  unsupported_mode: "Target driver does not support the requested run mode."
};

function schemaIdFromRole(role) {
  return role;
}

function summarizeValidatorErrors(errs) {
  if (!Array.isArray(errs) || errs.length === 0) return null;
  const first = errs[0];
  return {
    count: errs.length,
    first: `${first.instancePath || "<root>"} ${first.message || "invalid"}`
  };
}

export async function callOne({
  source = "cli",
  target: requestedTarget,
  role,
  task,
  inputText,
  model,
  timeoutS = DEFAULTS.timeout_s,
  maxTokens = DEFAULTS.max_tokens,
  allowSelf = false,
  registry: providedRegistry
} = {}) {
  const preGuards = checkGuards({ source, target: requestedTarget ?? "<auto>", role });
  if (preGuards.blocked) {
    return errorEnvelope({
      source,
      target: requestedTarget ?? null,
      role,
      model,
      error: preGuards.error,
      detail: { depth: preGuards.depth, max_depth: maxDepth(), trace: preGuards.trace ?? [] }
    });
  }

  const registry = providedRegistry ?? loadOrRefresh();
  const resolved = resolveTarget({ role, requested: requestedTarget, registry, allowSelf, source });
  if (resolved.error) {
    return errorEnvelope({
      source,
      target: resolved.target ?? requestedTarget ?? null,
      role,
      model,
      error: resolved.error,
      detail: { attempted: resolved.attempted }
    });
  }
  const target = resolved.target;
  const driver = DRIVERS[target];
  if (!driver) {
    return errorEnvelope({
      source, target, role, model,
      error: "target_not_implemented"
    });
  }

  const mode = driver.runModes[0] ?? SUBPROCESS;
  const composed = composePrompt({
    role,
    sourceHost: source,
    task,
    inputText,
    depth: currentDepth() + 1,
    maxDepth: maxDepth()
  });

  const jobId = generateJobId();
  const logPath = newJobLogPath({ source, target, role, jobId });
  const logger = new JobLogger(logPath);
  const startedAtIso = new Date().toISOString();
  const callStart = Date.now();

  logger.event("start", {
    job_id: jobId,
    source,
    target,
    role,
    mode,
    model: model ?? null,
    timeout_s: timeoutS,
    max_tokens: maxTokens,
    input_bytes: inputText ? Buffer.byteLength(inputText, "utf8") : 0,
    composed_prompt_bytes: Buffer.byteLength(composed.prompt, "utf8"),
    depth: currentDepth() + 1,
    schema_id: schemaIdFromRole(role)
  });

  let spec;
  try {
    spec = driver.buildInvocation({
      mode,
      prompt: composed.prompt,
      model,
      maxTokens,
      schemaPath: composed.schemaPath,
      schemaId: schemaIdFromRole(role)
    });
  } catch (err) {
    logger.event("build_invocation_error", { error: err.message });
    await logger.close();
    return errorEnvelope({
      source, target, role, model,
      error: "unsupported_mode",
      detail: { message: err.message }
    });
  }

  if (mode !== SUBPROCESS) {
    logger.event("build_invocation_error", { error: `mode ${mode} not implemented` });
    await logger.close();
    return errorEnvelope({
      source, target, role, model,
      error: "unsupported_mode",
      detail: { mode }
    });
  }

  const runResult = await runSubprocess({
    spec,
    childEnv: childEnv({ source, target, role }),
    timeoutS,
    logger
  });

  const payloadPath = await logger.payloadFile({
    prompt: spec.stdin,
    stdout: runResult.stdout ?? "",
    stderr: runResult.stderr ?? ""
  });
  logger.event("payload_saved", { path: payloadPath });

  const baseFields = {
    chorus_version: "0.1.0",
    job_id: jobId,
    source,
    target,
    role,
    model: model ?? null,
    started_at: startedAtIso,
    duration_ms: Date.now() - callStart,
    schema_id: schemaIdFromRole(role),
    trace_depth: currentDepth() + 1
  };

  if (runResult.error) {
    await logger.close();
    await appendJobIndex({ ...baseFields, ok: false, error: runResult.error, log_path: logPath });
    return {
      ...baseFields,
      ok: false,
      error: runResult.error,
      hint: ERROR_HINTS[runResult.error],
      ...projectErrorDetail(runResult)
    };
  }

  const assistantText = driver.extractAssistant(runResult, mode);
  const tokens = driver.extractTokens(runResult, mode);
  logger.event("extracted", { assistant_chars: assistantText.length, tokens });

  const schema = JSON.parse(fs.readFileSync(composed.schemaPath, "utf8"));
  const validation = await validateAndTrim({ raw: assistantText, schema });
  const cost = estimateCostUsd({ model, tokens });
  const withCost = { ...baseFields, tokens, cost_usd_estimate: round6(cost) };

  if (!validation.ok) {
    logger.event("validation_failed", { reason: validation.reason });
    await logger.close();
    const summarized = summarizeValidatorErrors(validation.validator_errors);
    await appendJobIndex({ ...withCost, ok: false, error: "schema_violation", log_path: logPath });
    return {
      ...withCost,
      ok: false,
      error: "schema_violation",
      reason: validation.reason,
      hint: ERROR_HINTS.schema_violation,
      validator_errors_summary: summarized,
      raw_excerpt: validation.raw_excerpt
    };
  }

  logger.event("validated", { fields_truncated: validation.fields_truncated });
  await logger.close();

  await appendJobIndex({ ...withCost, ok: true, log_path: logPath });

  return {
    ...withCost,
    ok: true,
    result: validation.result,
    warnings: validation.fields_truncated.length
      ? [`truncated ${validation.fields_truncated.length} string field(s)`]
      : []
  };
}

function projectErrorDetail(runResult) {
  const out = {};
  if (runResult.timeout_s !== undefined) out.timeout_s = runResult.timeout_s;
  if (runResult.limit_bytes !== undefined) out.limit_bytes = runResult.limit_bytes;
  if (runResult.exit_code !== undefined) out.exit_code = runResult.exit_code;
  if (runResult.stderr_excerpt !== undefined) out.stderr_excerpt = runResult.stderr_excerpt;
  if (runResult.detail !== undefined) out.detail = runResult.detail;
  if (runResult.orphaned) out.orphaned = true;
  if (Array.isArray(runResult.warnings) && runResult.warnings.length) {
    out.warnings = runResult.warnings;
  }
  return out;
}

function errorEnvelope({ source, target, role, model, error, detail }) {
  return {
    chorus_version: "0.1.0",
    source,
    target,
    role,
    model: model ?? null,
    schema_id: role ? schemaIdFromRole(role) : null,
    trace_depth: currentDepth() + 1,
    ok: false,
    error,
    hint: ERROR_HINTS[error],
    ...(detail ?? {})
  };
}

function round6(n) {
  if (typeof n !== "number" || !Number.isFinite(n)) return 0;
  return Number(n.toFixed(6));
}
