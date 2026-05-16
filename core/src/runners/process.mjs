import { spawn } from "node:child_process";
import { terminateProcessTreeWithEscalation } from "../process.mjs";
import { DEFAULTS } from "../budget.mjs";

/**
 * Run a subprocess InvocationSpec and return a structured RunResult.
 *
 * spec: { command, args, stdin }
 * options: { childEnv, timeoutS, logger, stdoutMax }
 *
 * Returns one of:
 *  - { error: "spawn_failed", detail }
 *  - { error: "timeout", timeout_s, orphaned?, durationMs }
 *  - { error: "stdout_overflow", limit_bytes, orphaned?, durationMs }
 *  - { error: "nonzero_exit", exit_code, stderr_excerpt, durationMs }
 *  - { stdout, stderr, exitCode, durationMs, warnings? }
 */
export async function runSubprocess({ spec, childEnv = {}, timeoutS, logger, stdoutMax = DEFAULTS.stdout_max_bytes, abortSignal }) {
  const startedAt = Date.now();
  let child;
  let stdoutBuf = Buffer.alloc(0);
  let stderrBuf = Buffer.alloc(0);
  let overflowed = false;
  let timedOut = false;
  let aborted = false;
  let exitCode = null;
  let signalReceived = null;
  let killOutcome = null;
  let killPromise = null;

  try {
    child = spawn(spec.command, spec.args, {
      env: { ...process.env, ...childEnv },
      stdio: ["pipe", "pipe", "pipe"],
      detached: process.platform !== "win32"
    });
  } catch (err) {
    logger?.event("spawn_error", { error: err.message });
    return { error: "spawn_failed", detail: err.message };
  }

  logger?.event("spawn", { pid: child.pid, command: spec.command, args: spec.args });

  function triggerKill(reason) {
    if (killPromise) return killPromise;
    killPromise = terminateProcessTreeWithEscalation(child.pid)
      .then((outcome) => {
        killOutcome = { ...outcome, reason };
        logger?.event("kill", killOutcome);
      })
      .catch((err) => {
        killOutcome = { error: err.message, reason };
        logger?.event("kill_error", killOutcome);
      });
    return killPromise;
  }

  const timer = setTimeout(() => {
    timedOut = true;
    triggerKill("timeout");
  }, timeoutS * 1000);

  let abortHandler;
  if (abortSignal) {
    if (abortSignal.aborted) {
      aborted = true;
      triggerKill("aborted");
    } else {
      abortHandler = () => {
        aborted = true;
        triggerKill("aborted");
      };
      abortSignal.addEventListener("abort", abortHandler, { once: true });
    }
  }

  child.stdout.on("data", (chunk) => {
    if (overflowed) return;
    if (stdoutBuf.length + chunk.length > stdoutMax) {
      overflowed = true;
      triggerKill("stdout_overflow");
      return;
    }
    stdoutBuf = Buffer.concat([stdoutBuf, chunk]);
  });
  child.stderr.on("data", (chunk) => {
    if (stderrBuf.length + chunk.length > stdoutMax) return;
    stderrBuf = Buffer.concat([stderrBuf, chunk]);
  });

  if (spec.stdin) {
    child.stdin.write(spec.stdin);
  }
  child.stdin.end();

  await new Promise((resolve) => {
    child.on("close", (code, signal) => {
      exitCode = code;
      signalReceived = signal;
      resolve();
    });
    child.on("error", (err) => {
      logger?.event("child_error", { error: err.message });
      resolve();
    });
  });

  clearTimeout(timer);
  if (abortHandler && abortSignal) {
    try { abortSignal.removeEventListener("abort", abortHandler); } catch { /* ignore */ }
  }
  if (killPromise) {
    await killPromise;
  }

  const stdout = stdoutBuf.toString("utf8");
  const stderr = stderrBuf.toString("utf8");
  const durationMs = Date.now() - startedAt;

  logger?.event("exit", {
    code: exitCode,
    signal: signalReceived,
    stdout_bytes: stdoutBuf.length,
    stderr_bytes: stderrBuf.length,
    duration_ms: durationMs,
    timed_out: timedOut,
    overflowed,
    kill_outcome: killOutcome
  });

  const orphanWarning = killOutcome?.orphaned
    ? `process ${child.pid} did not terminate after SIGTERM+SIGKILL — likely escaped the process group via setsid`
    : null;

  if (aborted) {
    return {
      error: "aborted",
      orphaned: Boolean(killOutcome?.orphaned),
      durationMs,
      ...(orphanWarning ? { warnings: [orphanWarning] } : {})
    };
  }
  if (timedOut) {
    return {
      error: "timeout",
      timeout_s: timeoutS,
      orphaned: Boolean(killOutcome?.orphaned),
      durationMs,
      ...(orphanWarning ? { warnings: [orphanWarning] } : {})
    };
  }
  if (overflowed) {
    return {
      error: "stdout_overflow",
      limit_bytes: stdoutMax,
      orphaned: Boolean(killOutcome?.orphaned),
      durationMs,
      ...(orphanWarning ? { warnings: [orphanWarning] } : {})
    };
  }
  if (exitCode !== 0) {
    return {
      error: "nonzero_exit",
      exit_code: exitCode,
      stderr_excerpt: stderr.slice(-2048),
      durationMs
    };
  }
  return { stdout, stderr, exitCode, durationMs };
}
