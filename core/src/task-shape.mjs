/**
 * Sequential vs parallel task shape classifier.
 *
 * Evidence (arxiv 2604.02460, normalized for tokens): single-agent matches
 * or beats multi-agent on sequential reasoning under equal thinking budgets;
 * multi-agent wins on parallelizable tasks (+81% on Finance-Agent), loses
 * up to −70% on sequential (PlanCraft).
 *
 * Chorus uses this to refuse `chorus council` on tasks whose shape is
 * sequential, suggesting `chorus call` instead. v0.1 is regex-heuristic;
 * a learned classifier can replace this later without changing the API.
 *
 * "Sequential" markers: explicit step ordering, dependent edits, refactor
 * chains, migration tasks. "Parallel" markers: review, research, propose,
 * critique — tasks where N independent angles add information.
 */

const SEQUENTIAL_TRIGGERS = [
  // explicit step ordering
  /\b(step\s+by\s+step|step-by-step|one\s+at\s+a\s+time|sequentially|in\s+order)\b/i,
  // dependent edit chains
  /\b(refactor|migrate|port|rewrite|upgrade)\s+(?:this|the|module|class|function)\b/i,
  /\b(then|after\s+that|next,?\s+|once\s+(?:that|this)\s+(?:is\s+)?done)\b/i,
  // explicit ordering keywords
  /\b(first[\s,.]+then[\s,]|first\s+\w+[,.]\s*then\b)/i,
  // counted step lists
  /\b(step\s*1|step\s*one|phase\s*1|phase\s*one)\b/i,
  // sequential file ops
  /\b(implement\s+(?:then|and\s+then)\s+test|build\s+(?:then|and\s+then)\s+deploy)\b/i
];

const PARALLEL_TRIGGERS = [
  /\b(review|research|investigate|critique|propose|brainstorm|compare|analyze|audit)\b/i,
  /\b(pros\s+and\s+cons|opinions?\s+on|perspectives?\s+on|what\s+do\s+you\s+think)\b/i,
  /\b(devil'?s\s+advocate|second\s+opinion|sanity\s+check)\b/i
];

export function classifyTaskShape(task) {
  if (typeof task !== "string" || !task.trim()) {
    return { shape: "unknown", confidence: 0, reasons: [] };
  }
  const reasons = [];
  let seqHits = 0;
  let parHits = 0;
  for (const re of SEQUENTIAL_TRIGGERS) {
    const m = task.match(re);
    if (m) {
      seqHits++;
      reasons.push(`sequential marker: "${m[0]}"`);
    }
  }
  for (const re of PARALLEL_TRIGGERS) {
    const m = task.match(re);
    if (m) {
      parHits++;
      reasons.push(`parallel marker: "${m[0]}"`);
    }
  }
  if (seqHits > parHits) {
    return {
      shape: "sequential",
      confidence: Math.min(1, seqHits / 3),
      reasons,
      hint: "Council under-performs on sequential tasks (arxiv 2604.02460). Use `chorus call` instead, or pass --force to override."
    };
  }
  if (parHits > 0) {
    return { shape: "parallel", confidence: Math.min(1, parHits / 3), reasons };
  }
  return { shape: "neutral", confidence: 0, reasons };
}

export function shouldRefuseCouncil(task, { force = false } = {}) {
  if (force) return { refuse: false };
  const c = classifyTaskShape(task);
  if (c.shape === "sequential" && c.confidence >= 0.34) {
    return { refuse: true, classifier: c };
  }
  return { refuse: false, classifier: c };
}
