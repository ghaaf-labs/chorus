import { AcpClient } from "../acp/client.mjs";

const POOL = new Map();
let exitHookInstalled = false;

function poolKey({ target, model, cwd }) {
  return `${target}|${model ?? ""}|${cwd ?? process.cwd()}`;
}

function installExitHook() {
  if (exitHookInstalled) return;
  exitHookInstalled = true;
  const drain = async () => {
    const clients = [...POOL.values()];
    POOL.clear();
    await Promise.allSettled(clients.map((c) => c.close()));
  };
  process.once("exit", () => {
    for (const c of POOL.values()) {
      try { c.proc?.kill("SIGTERM"); } catch { /* ignore */ }
    }
  });
  for (const sig of ["SIGINT", "SIGTERM"]) {
    process.once(sig, () => {
      drain().finally(() => process.exit(0));
    });
  }
}

export async function getOrStartClient({ target, spec, model, cwd, logger }) {
  installExitHook();
  const key = poolKey({ target, model, cwd });
  let client = POOL.get(key);
  if (client && !client._closed) return client;

  client = new AcpClient({ command: spec.command, args: spec.args, env: spec.env, cwd, logger });
  await client.start();
  await client.initialize();
  POOL.set(key, client);
  return client;
}

/**
 * Run an ACP InvocationSpec. Returns the same shape as runSubprocess so the
 * downstream extractors don't need to care which transport ran.
 *
 * spec: { command, args, env?, prompt }
 * options: { childEnv, timeoutS, logger, target, model, cwd }
 */
export async function runAcp({ spec, childEnv = {}, timeoutS, logger, target, model, cwd, abortSignal }) {
  const startedAt = Date.now();
  let client;
  try {
    client = await getOrStartClient({
      target,
      spec: { command: spec.command, args: spec.args, env: { ...childEnv, ...(spec.env || {}) } },
      model,
      cwd,
      logger
    });
  } catch (err) {
    logger?.event("acp_start_failed", { error: err.message });
    return { error: "spawn_failed", detail: err.message, durationMs: Date.now() - startedAt };
  }

  let sessionId;
  try {
    sessionId = await client.newSession({ cwd });
    logger?.event("acp_session_new", { session_id: sessionId });
  } catch (err) {
    logger?.event("acp_session_failed", { error: err.message });
    return { error: "spawn_failed", detail: err.message, durationMs: Date.now() - startedAt };
  }

  let abortHandler;
  if (abortSignal) {
    if (abortSignal.aborted) {
      try { client.cancelSession(sessionId); } catch { /* ignore */ }
    } else {
      abortHandler = () => {
        try { client.cancelSession(sessionId); } catch { /* ignore */ }
      };
      abortSignal.addEventListener("abort", abortHandler, { once: true });
    }
  }

  let timedOut = false;
  let aborted = false;
  try {
    const result = await client.prompt(sessionId, spec.prompt, {
      timeoutMs: timeoutS * 1000,
      onUpdate: (u) => logger?.event("acp_update", { sessionUpdate: u?.sessionUpdate })
    });
    const durationMs = Date.now() - startedAt;
    logger?.event("acp_exit", {
      stop_reason: result.stopReason,
      assistant_chars: result.assistantText.length,
      duration_ms: durationMs
    });
    return {
      stdout: result.assistantText,
      stderr: "",
      exitCode: 0,
      durationMs,
      stopReason: result.stopReason,
      thoughts: result.thoughts
    };
  } catch (err) {
    if (err?.message === "acp_prompt_timeout") {
      timedOut = true;
    } else if (err?.message === "acp_prompt_aborted" || abortSignal?.aborted) {
      aborted = true;
    }
    logger?.event("acp_prompt_failed", { error: err.message, timed_out: timedOut, aborted });
    if (aborted) {
      return { error: "aborted", stderr_excerpt: err.message, durationMs: Date.now() - startedAt };
    }
    return {
      error: timedOut ? "timeout" : "nonzero_exit",
      timeout_s: timedOut ? timeoutS : undefined,
      exit_code: timedOut ? undefined : -1,
      stderr_excerpt: err.message,
      durationMs: Date.now() - startedAt
    };
  } finally {
    if (abortHandler && abortSignal) {
      try { abortSignal.removeEventListener("abort", abortHandler); } catch { /* ignore */ }
    }
  }
}

export async function drainPool() {
  const clients = [...POOL.values()];
  POOL.clear();
  await Promise.allSettled(clients.map((c) => c.close()));
}

export function poolSize() {
  return POOL.size;
}
