import { callOne } from "./invoke.mjs";
import { DEFAULTS } from "./budget.mjs";
import { shouldRefuseCouncil } from "./task-shape.mjs";
import { generateJobId, appendJobIndex } from "./logging.mjs";

const VERDICT_PRIORITY = ["approve", "needs-attention", "inconclusive"];

export async function callCouncil({
  source = "cli",
  targets,
  role,
  task,
  inputText,
  model,
  timeoutS = DEFAULTS.timeout_s,
  registry,
  quorum,
  force = false
}) {
  if (!Array.isArray(targets) || targets.length === 0) {
    return { ok: false, error: "no_targets" };
  }

  const shape = shouldRefuseCouncil(task, { force });
  if (shape.refuse) {
    return {
      ok: false,
      error: "sequential_task",
      hint: shape.classifier?.hint,
      classifier: shape.classifier,
      role,
      attempted_targets: targets
    };
  }

  const councilRootId = generateJobId();
  const startedAtIso = new Date().toISOString();
  const callStart = Date.now();

  const results = await Promise.all(
    targets.map((target) =>
      callOne({
        source,
        target,
        role,
        task,
        inputText,
        model,
        timeoutS,
        registry,
        parentJobIds: [councilRootId]
      })
    )
  );

  const participants = results.map((r) => ({
    target: r.target,
    job_id: r.job_id ?? null,
    ok: r.ok,
    verdict: r.result?.verdict ?? null,
    error: r.ok ? null : r.error
  }));

  const weights = Object.fromEntries(
    targets.map((t) => [t, registry?.hosts?.[t]?.vote_weight ?? 1.0])
  );

  const verdictWeights = {};
  for (const r of results) {
    if (!r.ok) continue;
    const v = r.result?.verdict;
    if (!v) continue;
    verdictWeights[v] = (verdictWeights[v] || 0) + (weights[r.target] ?? 1.0);
  }

  const consensus = pickConsensus(verdictWeights);
  const totalWeight = Object.values(weights).reduce((a, b) => a + b, 0);
  const winningWeight = consensus ? verdictWeights[consensus] ?? 0 : 0;

  let quorumOk = true;
  let quorumDetail = null;
  if (quorum) {
    const m = String(quorum).match(/^(\d+)-of-(\d+)$/);
    if (m) {
      const need = Number.parseInt(m[1], 10);
      const okCount = participants.filter((p) => p.ok && p.verdict === consensus).length;
      quorumOk = okCount >= need;
      quorumDetail = { need, got: okCount, of: participants.length };
    }
  }

  const dissent = results
    .filter((r) => r.ok && r.result?.verdict && r.result.verdict !== consensus)
    .map((r) => ({ target: r.target, verdict: r.result.verdict, weight: weights[r.target] ?? 1.0 }));

  const failures = results
    .filter((r) => !r.ok)
    .map((r) => ({ target: r.target, error: r.error }));

  const envelope = {
    chorus_version: "0.1.0",
    job_id: councilRootId,
    source,
    target: "council",
    role,
    model: model ?? null,
    started_at: startedAtIso,
    duration_ms: Date.now() - callStart,
    parent_job_ids: [],
    ok: Boolean(consensus) && quorumOk,
    error: !consensus ? "no_consensus" : (!quorumOk ? "quorum_not_met" : null),
    consensus,
    consensus_weight: winningWeight,
    total_weight: totalWeight,
    quorum: quorumDetail,
    participants,
    dissent,
    failures
  };

  await appendJobIndex({
    chorus_version: "0.1.0",
    job_id: councilRootId,
    source,
    target: "council",
    role,
    model: model ?? null,
    started_at: startedAtIso,
    duration_ms: envelope.duration_ms,
    parent_job_ids: [],
    ok: envelope.ok,
    error: envelope.error ?? undefined,
    consensus
  });

  return envelope;
}

function pickConsensus(verdictWeights) {
  const entries = Object.entries(verdictWeights);
  if (!entries.length) return null;
  entries.sort(([va, wa], [vb, wb]) => {
    if (wb !== wa) return wb - wa;
    return VERDICT_PRIORITY.indexOf(va) - VERDICT_PRIORITY.indexOf(vb);
  });
  // Tie at top weight → null (no consensus)
  if (entries.length > 1 && entries[0][1] === entries[1][1]) return null;
  return entries[0][0];
}
