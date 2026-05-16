import { callOne } from "./invoke.mjs";
import { DEFAULTS } from "./budget.mjs";

export async function callCouncil({
  source = "cli",
  targets,
  role,
  task,
  inputText,
  model,
  timeoutS = DEFAULTS.timeout_s,
  registry
}) {
  if (!Array.isArray(targets) || targets.length === 0) {
    return { ok: false, error: "no_targets" };
  }

  const results = await Promise.all(
    targets.map((target) =>
      callOne({ source, target, role, task, inputText, model, timeoutS, registry })
    )
  );

  const okResults = results.filter((r) => r.ok);
  const verdicts = okResults
    .map((r) => r.result?.verdict)
    .filter(Boolean);
  const verdictCount = verdicts.reduce((acc, v) => {
    acc[v] = (acc[v] || 0) + 1;
    return acc;
  }, {});

  return {
    ok: okResults.length > 0,
    role,
    participants: results.map((r) => ({
      target: r.target,
      ok: r.ok,
      verdict: r.result?.verdict ?? null,
      error: r.ok ? null : r.error
    })),
    consensus: pickConsensus(verdictCount),
    dissent: okResults
      .filter((r) => r.result?.verdict && r.result.verdict !== pickConsensus(verdictCount))
      .map((r) => ({ target: r.target, verdict: r.result.verdict })),
    results
  };
}

function pickConsensus(counts) {
  let best = null;
  let bestCount = 0;
  for (const [v, c] of Object.entries(counts)) {
    if (c > bestCount) {
      best = v;
      bestCount = c;
    }
  }
  return best;
}
