import { spawn } from "node:child_process";
import { terminateProcessTree } from "../process.mjs";
import { DEFAULTS } from "../budget.mjs";

/**
 * Run a subprocess InvocationSpec and return a structured RunResult.
 *
 * spec: { command, args, stdin }
 * options: { childEnv, timeoutS, logger, stdoutMax }
 *
 * Returns one of:
 *  - { error: "spawn_failed", detail }
 *  - { error: "timeout", timeout_s }
 *  - { error: "stdout_overflow", limit_bytes }
 *  - { error: "nonzero_exit", exit_code, stderr_excerpt }
 *  - { stdout, stderr, exitCode, durationMs }
 */
export async function runSubprocess({ spec, childEnv = {}, timeoutS, logger, stdoutMax = DEFAULTS.stdout_max_bytes }) {
  const startedAt = Date.now();
  let child;
  let stdoutBuf = Buffer.alloc(0);
  let stderrBuf = Buffer.alloc(0);
  let overflowed = false;
  let timedOut = false;
  let exitCode = null;
  let signalReceived = null;

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

  const timer = setTimeout(() => {
    timedOut = true;
    terminateProcessTree(child.pid);
  }, timeoutS * 1000);

  child.stdout.on("data", (chunk) => {
    if (overflowed) return;
    if (stdoutBuf.length + chunk.length > stdoutMax) {
      overflowed = true;
      terminateProcessTree(child.pid);
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
    overflowed
  });

  if (timedOut) return { error: "timeout", timeout_s: timeoutS, durationMs };
  if (overflowed) return { error: "stdout_overflow", limit_bytes: stdoutMax, durationMs };
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
