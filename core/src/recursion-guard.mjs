const DEPTH_ENV = "CHORUS_DEPTH";
const TRACE_ENV = "CHORUS_TRACE";

export function maxDepth() {
  return Number.parseInt(process.env.CHORUS_MAX_DEPTH ?? "2", 10);
}

export function currentDepth() {
  return Number.parseInt(process.env[DEPTH_ENV] ?? "0", 10) || 0;
}

export function currentTrace() {
  const raw = process.env[TRACE_ENV];
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function childEnv({ source, target, role }) {
  const trace = currentTrace();
  trace.push({ source, target, role });
  return {
    [DEPTH_ENV]: String(currentDepth() + 1),
    [TRACE_ENV]: JSON.stringify(trace)
  };
}

export function checkGuards({ source, target, role }) {
  const depth = currentDepth();
  const limit = maxDepth();
  if (depth >= limit) {
    return {
      blocked: true,
      error: "max_depth_exceeded",
      depth,
      max_depth: limit,
      trace: currentTrace(),
      resolution: `Raise CHORUS_MAX_DEPTH (current=${limit}) or simplify the buddy chain — depth ${depth} already reached the limit before this call.`
    };
  }
  const trace = currentTrace();
  const edge = `${source}->${target}:${role}`;
  const existing = trace.map((t) => `${t.source}->${t.target}:${t.role}`);
  if (existing.includes(edge)) {
    return {
      blocked: true,
      error: "cycle",
      edge,
      trace,
      resolution: `The edge '${edge}' already appears in this chain. Break the cycle by changing role (try a different role on this target) or by calling --allow-self if intentional.`
    };
  }
  return { blocked: false };
}
