import { spawnSync } from "node:child_process";
import process from "node:process";
import { setTimeout as sleep } from "node:timers/promises";

function isAlive(pid, killImpl) {
  try {
    killImpl(pid, 0);
    return true;
  } catch (err) {
    if (err?.code === "ESRCH") return false;
    if (err?.code === "EPERM") return true;
    return true;
  }
}

function signalGroup(pid, signal, killImpl) {
  try {
    killImpl(-pid, signal);
    return { delivered: true, method: "process-group" };
  } catch (err) {
    if (err?.code === "ESRCH") return { delivered: false, method: "process-group" };
    try {
      killImpl(pid, signal);
      return { delivered: true, method: "process" };
    } catch (err2) {
      if (err2?.code === "ESRCH") return { delivered: false, method: "process" };
      throw err2;
    }
  }
}

export function terminateProcessTree(pid, options = {}) {
  if (!Number.isFinite(pid)) {
    return { attempted: false, delivered: false, method: null };
  }
  const platform = options.platform ?? process.platform;
  const killImpl = options.killImpl ?? process.kill.bind(process);

  if (platform === "win32") {
    const result = spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
      encoding: "utf8",
      windowsHide: true
    });
    if (!result.error && result.status === 0) {
      return { attempted: true, delivered: true, method: "taskkill" };
    }
    try {
      killImpl(pid);
      return { attempted: true, delivered: true, method: "kill" };
    } catch (error) {
      if (error?.code === "ESRCH") return { attempted: true, delivered: false, method: "kill" };
      throw error;
    }
  }

  return { attempted: true, ...signalGroup(pid, "SIGTERM", killImpl) };
}

/**
 * Async variant that escalates SIGTERM → SIGKILL with a grace window and
 * verifies the process actually terminated. Returns:
 *   { delivered: bool, escalated: bool, orphaned: bool, method: string }
 *
 * `orphaned: true` means the PID is still alive after SIGTERM + SIGKILL.
 * In practice this happens when a grandchild called setsid() to detach
 * itself from our process group, or on Linux when the process is in
 * uninterruptible sleep (D state). The caller should surface this as a
 * warning — Chorus cannot guarantee cleanup beyond this point.
 */
export async function terminateProcessTreeWithEscalation(pid, options = {}) {
  if (!Number.isFinite(pid)) {
    return { delivered: false, escalated: false, orphaned: false, method: null };
  }
  const platform = options.platform ?? process.platform;
  const killImpl = options.killImpl ?? process.kill.bind(process);
  const graceMs = options.graceMs ?? 2000;
  const finalGraceMs = options.finalGraceMs ?? 500;
  const pollMs = options.pollMs ?? 50;

  if (platform === "win32") {
    return { ...terminateProcessTree(pid, options), escalated: false, orphaned: false };
  }

  const term = signalGroup(pid, "SIGTERM", killImpl);
  if (!isAlive(pid, killImpl)) {
    return { delivered: term.delivered, escalated: false, orphaned: false, method: term.method };
  }
  await waitGone(pid, graceMs, pollMs, killImpl);
  if (!isAlive(pid, killImpl)) {
    return { delivered: true, escalated: false, orphaned: false, method: term.method };
  }

  signalGroup(pid, "SIGKILL", killImpl);
  await waitGone(pid, finalGraceMs, pollMs, killImpl);
  if (!isAlive(pid, killImpl)) {
    return { delivered: true, escalated: true, orphaned: false, method: "sigkill-group" };
  }
  return { delivered: true, escalated: true, orphaned: true, method: "sigkill-group" };
}

async function waitGone(pid, deadlineMs, pollMs, killImpl) {
  const deadline = Date.now() + deadlineMs;
  while (Date.now() < deadline) {
    if (!isAlive(pid, killImpl)) return;
    await sleep(pollMs);
  }
}
