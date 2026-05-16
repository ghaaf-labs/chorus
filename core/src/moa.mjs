/**
 * Mixture-of-Agents layering.
 *
 * Spec: `l1=a,b; l2=c[; l3=d]`
 *
 * Layer 1 fans out the task to each layer-1 target in parallel.
 * Each subsequent layer pipes the previous layer's outputs (concatenated)
 * as <untrusted> <input> to each of its targets and re-runs the same role.
 * The final return is the last layer's results.
 *
 * Parent linkage: layer-N participants link to all layer-(N-1) job_ids.
 */
import { callOne } from "./invoke.mjs";

export function parseMoaSpec(spec) {
  if (typeof spec !== "string" || !spec.trim()) return null;
  const layers = [];
  for (const seg of spec.split(/[;\n]/)) {
    const t = seg.trim();
    if (!t) continue;
    const m = t.match(/^l(\d+)\s*=\s*(.+)$/i);
    if (!m) return null;
    const idx = Number.parseInt(m[1], 10);
    const targets = m[2].split(",").map((s) => s.trim()).filter(Boolean);
    if (!targets.length) return null;
    layers[idx - 1] = targets;
  }
  if (layers.some((l) => !l || !l.length)) return null;
  return layers;
}

function formatLayerInput(originalInput, layerResults) {
  const blocks = layerResults.map((r, i) => {
    const tag = `[layer participant ${i + 1}: ${r.target}]`;
    const body = r.ok ? JSON.stringify(r.result, null, 2) : `ERROR: ${r.error}`;
    return `${tag}\n${body}`;
  }).join("\n\n---\n\n");
  return (originalInput ? originalInput + "\n\n---\n\n" : "") + blocks;
}

export async function runMoa({ layers, source, role, task, inputText, model, timeoutS, registry }) {
  let prevResults = null;
  for (let i = 0; i < layers.length; i++) {
    const targets = layers[i];
    const isFirst = i === 0;
    const parentIds = prevResults ? prevResults.map((r) => r.job_id).filter(Boolean) : undefined;
    const layerInput = isFirst ? inputText : formatLayerInput(inputText, prevResults);
    const results = await Promise.all(
      targets.map((target) =>
        callOne({
          source,
          target,
          role,
          task,
          inputText: layerInput,
          model,
          timeoutS,
          registry,
          parentJobIds: parentIds,
          untrustedInput: !isFirst,
          allowSelf: true
        })
      )
    );
    prevResults = results;
  }
  return {
    ok: prevResults.every((r) => r.ok),
    role,
    layers_count: layers.length,
    final_layer: prevResults
  };
}
