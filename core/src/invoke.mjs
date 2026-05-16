import fs from "node:fs";
import { DEFAULTS } from "./budget.mjs";
import { childEnv, checkGuards, currentDepth, maxDepth } from "./recursion-guard.mjs";
import * as claudeDriver from "./targets/claude.mjs";
import * as codexDriver from "./targets/codex.mjs";
import * as opencodeDriver from "./targets/opencode.mjs";
import * as grokDriver from "./targets/grok.mjs";
import * as grokBuildDriver from "./targets/grok-build.mjs";
import * as copilotDriver from "./targets/copilot.mjs";
import * as knowledgeDriver from "./targets/knowledge.mjs";
import { SUBPROCESS, ACP } from "./targets/driver.mjs";
import { runSubprocess } from "./runners/process.mjs";
import { runAcp } from "./runners/acp.mjs";
import { composePrompt } from "./roles/compose.mjs";
import { validateAndTrim } from "./summarize.mjs";
import { generateJobId, JobLogger, newJobLogPath, appendJobIndex } from "./logging.mjs";
import { resolveTarget } from "./roles/defaults.mjs";
import { loadOrRefresh } from "./registry.mjs";
import { estimateCostUsd } from "./pricing.mjs";
import { redactText, redactionEnabled } from "./redact.mjs";
import { checkBudget, recordSpend } from "./budget-firewall.mjs";
import { emitSpan, newTraceContext, nowNs } from "./otel.mjs";

const DRIVERS = {
  "claude-code": claudeDriver,
  codex: codexDriver,
  opencode: opencodeDriver,
  grok: grokDriver,
  "grok-build": grokBuildDriver,
  copilot: copilotDriver,
  knowledge: knowledgeDriver
};

const ERROR_HINTS = {
  timeout: "Increase --timeout, or check whether the target is hanging.",
  aborted: "The call was cancelled by the caller (Ctrl-C, session/cancel, or AbortController.abort()).",
  budget_exceeded: "Budget firewall blocked the call. Edit ~/.chorus/budget.json (set warn_only: true to log instead of block) or pass a cheaper --model.",
  placeholder_leak: "Model output contained a <chorus-redacted:*> placeholder that wasn't in the input mapping — possible exfiltration or token hallucination. Quarantined.",
  stdout_overflow: "The target emitted more output than CHORUS_STDOUT_MAX_BYTES allows; the target may be misbehaving.",
  schema_violation: "The target's reply did not match the role's JSON schema. Inspect the .payload.json sidecar in ~/.chorus/logs/ for the raw output.",
  spawn_failed: "Could not start the target binary. Run `chorus doctor` to verify it is installed and authed.",
  nonzero_exit: "The target exited non-zero. Check the stderr_excerpt and run `chorus doctor`.",
  no_available_target: "Run `chorus setup` to refresh the capability registry.",
  target_unavailable: "Run `chorus setup` or check the target's auth status.",
  target_not_implemented: "This target is registered but not wired in this build. See docs/architecture.md.",
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
  registry: providedRegistry,
  mode: requestedMode,
  parentJobIds,
  abortSignal,
  untrustedInput = false,
  redact = false
} = {}) {
  const willRedact = redact || redactionEnabled();
  let redactionMapping = [];
  if (willRedact) {
    if (typeof task === "string" && task) {
      const r = redactText(task);
      task = r.text;
      redactionMapping = redactionMapping.concat(r.mapping);
    }
    if (typeof inputText === "string" && inputText) {
      const r = redactText(inputText);
      inputText = r.text;
      redactionMapping = redactionMapping.concat(r.mapping);
    }
  }
  const preGuards = checkGuards({ source, target: requestedTarget ?? "<auto>", role });
  if (preGuards.blocked) {
    return errorEnvelope({
      source,
      target: requestedTarget ?? null,
      role,
      model,
      parentJobIds,
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
      parentJobIds,
      error: resolved.error,
      detail: { attempted: resolved.attempted }
    });
  }
  const target = resolved.target;
  const driver = DRIVERS[target];
  if (!driver) {
    return errorEnvelope({
      source, target, role, model, parentJobIds,
      error: "target_not_implemented"
    });
  }

  const mode = pickMode(driver, requestedMode);
  const composed = composePrompt({
    role,
    sourceHost: source,
    task,
    inputText,
    depth: currentDepth() + 1,
    maxDepth: maxDepth(),
    untrusted: Boolean(untrustedInput)
  });

  const jobId = generateJobId();
  const logPath = newJobLogPath({ source, target, role, jobId });
  const logger = new JobLogger(logPath);
  const startedAtIso = new Date().toISOString();
  const callStart = Date.now();
  const traceCtx = newTraceContext();
  const spanStartNs = nowNs();

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
    schema_id: schemaIdFromRole(role),
    parent_job_ids: parentJobIds ?? []
  });

  let spec;
  try {
    spec = driver.buildInvocation({
      mode,
      prompt: composed.prompt,
      task,
      model,
      maxTokens,
      schemaPath: composed.schemaPath,
      schemaId: schemaIdFromRole(role)
    });
  } catch (err) {
    logger.event("build_invocation_error", { error: err.message });
    await logger.close();
    return errorEnvelope({
      source, target, role, model, parentJobIds,
      error: "unsupported_mode",
      detail: { message: err.message }
    });
  }

  // Budget firewall pre-flight (after build, before spawn).
  const budgetCheck = checkBudget({
    model,
    promptBytes: Buffer.byteLength(spec.stdin || spec.prompt || composed.prompt, "utf8"),
    maxOutputTokens: maxTokens,
    target
  });
  if (!budgetCheck.allow) {
    logger.event("budget_block", budgetCheck);
    await logger.close();
    return errorEnvelope({
      source, target, role, model, parentJobIds,
      error: "budget_exceeded",
      detail: {
        estimated_cost_usd: budgetCheck.estimated_cost_usd,
        ceiling_usd: budgetCheck.ceiling_usd,
        scope: budgetCheck.scope,
        today_spent_usd: budgetCheck.today_spent_usd
      }
    });
  }
  if (budgetCheck.warning) logger.event("budget_warn", { warning: budgetCheck.warning });

  const childExtraEnv = childEnv({ source, target, role });
  let runResult;
  if (mode === ACP) {
    runResult = await runAcp({
      spec,
      childEnv: childExtraEnv,
      timeoutS,
      logger,
      target,
      model,
      cwd: process.cwd(),
      abortSignal
    });
  } else if (mode === SUBPROCESS) {
    runResult = await runSubprocess({
      spec,
      childEnv: childExtraEnv,
      timeoutS,
      logger,
      abortSignal
    });
  } else {
    logger.event("build_invocation_error", { error: `mode ${mode} not implemented` });
    await logger.close();
    return errorEnvelope({
      source, target, role, model, parentJobIds,
      error: "unsupported_mode",
      detail: { mode }
    });
  }

  const payloadPath = await logger.payloadFile({
    prompt: spec.stdin,
    task: task ?? null,
    input_text: inputText ?? null,
    redaction_mapping: redactionMapping,
    redaction_active: willRedact,
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
    trace_depth: currentDepth() + 1,
    parent_job_ids: parentJobIds ?? []
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

  // Outbound redact-placeholder invariant: if we redacted on the way in,
  // no placeholder should appear in the
  // model's output that wasn't given to it. A placeholder it never saw
  // is evidence of exfiltration or hallucination of redaction tokens.
  if (willRedact && typeof assistantText === "string") {
    const inputPlaceholders = new Set(redactionMapping.map((m) => m.placeholder));
    const outputPlaceholders = assistantText.match(/<chorus-redacted:[a-z_]+:\d+>/g) ?? [];
    const leaked = outputPlaceholders.filter((p) => !inputPlaceholders.has(p));
    if (leaked.length) {
      logger.event("placeholder_leak", { leaked });
      await logger.close();
      await appendJobIndex({ ...baseFields, ok: false, error: "placeholder_leak", log_path: logPath });
      return errorEnvelope({
        source, target, role, model, parentJobIds,
        error: "placeholder_leak",
        detail: { leaked }
      });
    }
  }

  let tokens = driver.extractTokens(runResult, mode);
  // ACP token fallback: most ACP-mode drivers can't recover usage stats from
  // the agent (the spec doesn't standardize it). When tokens are zero on ACP,
  // estimate from prompt + output bytes at ~4 chars/token; flag as estimated.
  if (mode === ACP && (!tokens || tokens.total === 0)) {
    const promptChars = Buffer.byteLength(spec.prompt || composed.prompt || "", "utf8");
    const outputChars = Buffer.byteLength(assistantText || "", "utf8");
    const input = Math.ceil(promptChars / 4);
    const output = Math.ceil(outputChars / 4);
    tokens = { input, output, total: input + output, estimated: true };
  }
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

  await appendJobIndex({
    ...withCost,
    ok: true,
    verdict: validation.result?.verdict ?? null,
    log_path: logPath
  });
  recordSpend(cost);

  await emitSpan({
    name: `chorus.call.${role}`,
    traceId: traceCtx.trace_id,
    spanId: traceCtx.span_id,
    startNs: spanStartNs,
    endNs: nowNs(),
    attributes: {
      "chorus.job_id": jobId,
      "chorus.source": source,
      "chorus.target": target,
      "chorus.role": role,
      "chorus.model": model ?? "",
      "chorus.mode": mode,
      "chorus.tokens.input": tokens.input,
      "chorus.tokens.output": tokens.output,
      "chorus.tokens.total": tokens.total,
      "chorus.tokens.estimated": Boolean(tokens.estimated),
      "chorus.cost_usd": cost,
      "gen_ai.system": target,
      "gen_ai.operation.name": "chat",
      "gen_ai.request.model": model ?? "",
      "gen_ai.response.model": model ?? "",
      "gen_ai.usage.input_tokens": tokens.input,
      "gen_ai.usage.output_tokens": tokens.output,
      "gen_ai.usage.total_tokens": tokens.total,
      "gen_ai.usage.cost": cost
    },
    status: "OK"
  });

  return {
    ...withCost,
    ok: true,
    result: validation.result,
    warnings: validation.fields_truncated.length
      ? [`truncated ${validation.fields_truncated.length} string field(s)`]
      : []
  };
}

function pickMode(driver, requested) {
  const supported = driver.runModes || [SUBPROCESS];
  if (requested) {
    if (!supported.includes(requested)) {
      throw new Error(`target "${driver.id}" does not support mode "${requested}"; supported: ${supported.join(",")}`);
    }
    return requested;
  }
  if (process.env.CHORUS_FORCE_MODE) {
    const forced = process.env.CHORUS_FORCE_MODE;
    if (supported.includes(forced)) return forced;
  }
  if (process.env.CHORUS_DISABLE_ACP === "1") {
    return supported.find((m) => m !== ACP) || supported[0];
  }
  return supported[0];
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

function errorEnvelope({ source, target, role, model, error, detail, parentJobIds }) {
  return {
    chorus_version: "0.1.0",
    source,
    target,
    role,
    model: model ?? null,
    schema_id: role ? schemaIdFromRole(role) : null,
    trace_depth: currentDepth() + 1,
    parent_job_ids: parentJobIds ?? [],
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
