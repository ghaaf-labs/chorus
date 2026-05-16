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
  // Codex review (HIGH): duplicate targets would let one host's vote be
  // counted N times and trivially satisfy quorum. Dedupe up front while
  // preserving order.
  const seenT = new Set();
  const dedupedTargets = [];
  for (const t of targets) {
    if (!seenT.has(t)) { seenT.add(t); dedupedTargets.push(t); }
  }
  if (dedupedTargets.length < targets.length) {
    // Caller passed dupes; we silently dedupe but flag a warning.
  }
  targets = dedupedTargets;

  // Validate quorum spec: must be K-of-N with 1 <= K <= N <= targets.length.
  let quorumNeed = null;
  let quorumOf = targets.length;
  if (quorum) {
    const m = String(quorum).match(/^(\d+)-of-(\d+)$/);
    if (!m) {
      return { ok: false, error: "bad_quorum", hint: `quorum '${quorum}' is not in K-of-N form` };
    }
    quorumNeed = Number.parseInt(m[1], 10);
    quorumOf = Number.parseInt(m[2], 10);
    if (quorumNeed < 1 || quorumOf < 1 || quorumNeed > quorumOf || quorumOf > targets.length) {
      return {
        ok: false,
        error: "bad_quorum",
        hint: `quorum '${quorum}' invalid: need 1<=K<=N and N<=${targets.length} (distinct targets)`
      };
    }
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

  // Coerce + validate vote_weight: must be a finite positive number; else 1.0.
  const weights = Object.fromEntries(
    targets.map((t) => {
      const raw = registry?.hosts?.[t]?.vote_weight;
      const n = typeof raw === "number" && Number.isFinite(raw) && raw > 0 ? raw : 1.0;
      return [t, n];
    })
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
  if (quorumNeed !== null) {
    const okCount = participants.filter((p) => p.ok && p.verdict === consensus).length;
    quorumOk = okCount >= quorumNeed;
    quorumDetail = { need: quorumNeed, got: okCount, of: participants.length };
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
  const entries = Object.entries(verdictWeights)
    .filter(([, w]) => typeof w === "number" && Number.isFinite(w));
  if (!entries.length) return null;
  entries.sort(([va, wa], [vb, wb]) => {
    if (wb !== wa) return wb - wa;
    return VERDICT_PRIORITY.indexOf(va) - VERDICT_PRIORITY.indexOf(vb);
  });
  // Tie at top weight (within float tolerance) → null (no consensus).
  if (entries.length > 1 && Math.abs(entries[0][1] - entries[1][1]) < 1e-9) return null;
  return entries[0][0];
}
