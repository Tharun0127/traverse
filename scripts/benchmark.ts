/**
 * Benchmark harness.
 *
 * Everything here is measured deterministically — token counts from the real
 * tokenizer, routing from the real primitives, attack effect and detection from
 * the real audit code. No model is involved, and no number is estimated.
 *
 * That boundary is deliberate. End-to-end answer accuracy needs a language model
 * and therefore an API key; it is reported separately and marked as not-yet-run
 * rather than filled with a plausible guess. The claim this project makes is
 * about token economics and routing integrity, and both are fully measurable
 * without a model.
 *
 *   npx tsx scripts/benchmark.ts
 */

import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { CORPUS } from "../src/data/corpus.generated";
import { QUESTIONS, TASK_TYPES, type Question } from "../src/data/questions";
import { transpileSync } from "../src/lib/og/transpiler";
import { searchIndex, resolveContext } from "../src/lib/og/primitives";
import { auditDocument, assessRouting, poison, ATTACKS, type AttackKind } from "../src/lib/og/poison";
import { countTokens, costUsd } from "../src/lib/og/tokens";
import type { OgDocument } from "../src/lib/og/types";

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, "..", "src", "data", "benchmark.json");

const ATTACK_KINDS: AttackKind[] = [
  "keyword-hijack",
  "confidence-inflation",
  "omission",
  "dense-lie",
];

const RESOLVE_TOP_K = 2;

const docs = new Map<string, OgDocument>();
for (const d of CORPUS) docs.set(d.id, transpileSync(d.markdown, { title: d.title }));

/** What traversal actually pulls into context for one question. */
function traversalCost(doc: OgDocument, q: Question) {
  const role = q.role ?? "all";
  const seed = searchIndex(doc, q.q, role, { includeDense: false, limit: 12 });
  const dense = searchIndex(doc, q.q, role, { includeDense: true, limit: 5 });
  const picks = dense.matches.slice(0, RESOLVE_TOP_K).map((m) => m.entry.id);
  const resolved = resolveContext(doc, picks, role);
  return {
    indexTokens: seed.tokens,
    denseTokens: dense.tokens,
    fullTokens: resolved.tokens,
    total: seed.tokens + dense.tokens + resolved.tokens,
    topNode: dense.matches[0]?.entry.id,
    nodesRead: [...resolved.requested, ...resolved.followed],
  };
}

/* ---------------- token economics ---------------- */

const perQuestion = QUESTIONS.map((q) => {
  const source = CORPUS.find((c) => c.id === q.docId)!;
  const doc = docs.get(q.docId)!;
  const injectionTokens = countTokens(
    `<document>\n${source.markdown}\n</document>\n\nQuestion: ${q.q}`
  );
  const t = traversalCost(doc, q);
  return {
    id: q.id,
    docId: q.docId,
    task: q.task,
    question: q.q,
    injectionTokens,
    traversalTokens: t.total,
    breakdown: { index: t.indexTokens, dense: t.denseTokens, full: t.fullTokens },
    reduction: 1 - t.total / injectionTokens,
    injectionCost: costUsd(injectionTokens, 60),
    traversalCost: costUsd(t.total, 60),
    nodesRead: t.nodesRead.length,
    totalNodes: doc.nodes.length,
  };
});

const meanReduction =
  perQuestion.reduce((a, b) => a + b.reduction, 0) / perQuestion.length;
const sorted = [...perQuestion].sort((a, b) => a.reduction - b.reduction);
const medianReduction = sorted[Math.floor(sorted.length / 2)].reduction;

const byDocClass = CORPUS.map((c) => {
  const rows = perQuestion.filter((p) => p.docId === c.id);
  const doc = docs.get(c.id)!;
  return {
    docId: c.id,
    title: c.title,
    cls: c.cls,
    questions: rows.length,
    docTokens: countTokens(c.markdown),
    nodes: doc.nodes.length,
    meanReduction: rows.reduce((a, b) => a + b.reduction, 0) / rows.length,
    meanInjection: Math.round(rows.reduce((a, b) => a + b.injectionTokens, 0) / rows.length),
    meanTraversal: Math.round(rows.reduce((a, b) => a + b.traversalTokens, 0) / rows.length),
  };
});

const byTask = TASK_TYPES.map((task) => {
  const rows = perQuestion.filter((p) => p.task === task);
  return {
    task,
    questions: rows.length,
    meanReduction: rows.length ? rows.reduce((a, b) => a + b.reduction, 0) / rows.length : null,
  };
});

/* ---------------- how reduction scales with document size ---------------- */

/**
 * The headline gap against the paper's 92% mean is almost entirely explained by
 * document size. Traversal's cost is roughly constant — an index, a few dense
 * summaries, two resolved nodes — while injection's cost grows linearly with the
 * document. So reduction is not a property of the format alone; it is a function
 * of how much document you are not reading.
 */
const sizeScaling = byDocClass
  .map((c) => ({
    docId: c.docId,
    cls: c.cls,
    docTokens: c.docTokens,
    meanInjection: c.meanInjection,
    meanTraversal: c.meanTraversal,
    meanReduction: c.meanReduction,
  }))
  .sort((a, b) => a.docTokens - b.docTokens);

// Correlation between document size and reduction, over questions.
const xs = perQuestion.map((p) => p.injectionTokens);
const ys = perQuestion.map((p) => p.reduction);
const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
const my = ys.reduce((a, b) => a + b, 0) / ys.length;
const cov = xs.reduce((a, x, i) => a + (x - mx) * (ys[i] - my), 0);
const sdx = Math.sqrt(xs.reduce((a, x) => a + (x - mx) ** 2, 0));
const sdy = Math.sqrt(ys.reduce((a, y) => a + (y - my) ** 2, 0));
const sizeCorrelation = cov / (sdx * sdy);

/* ---------------- adversarial audit ---------------- */

const cleanFalsePositives = QUESTIONS.filter(
  (q) => assessRouting(docs.get(q.docId)!, q.q, q.role ?? "all").shouldVerify
).length;

const cleanCiFindings = CORPUS.reduce(
  (a, c) => a + auditDocument(docs.get(c.id)!).length,
  0
);

const attacks = ATTACK_KINDS.map((kind) => {
  let n = 0;
  let routingChanged = 0;
  let queryDetected = 0;
  let ciDetected = 0;

  for (const q of QUESTIONS) {
    const role = q.role ?? "all";
    const clean = docs.get(q.docId)!;
    const target = searchIndex(clean, q.q, role).matches[0]?.entry.id;
    if (!target) continue;
    n++;

    const { doc: pd } = poison(clean, { kind, targetId: target });
    const after = searchIndex(pd, q.q, role).matches[0]?.entry.id;
    if (after !== target) routingChanged++;
    if (assessRouting(pd, q.q, role).shouldVerify) queryDetected++;
    if (auditDocument(pd).length > 0) ciDetected++;
  }

  return {
    kind,
    label: ATTACKS[kind].label,
    description: ATTACKS[kind].description,
    tell: ATTACKS[kind].tell,
    n,
    routingChanged,
    routingChangedPct: routingChanged / n,
    queryDetected,
    queryDetectedPct: queryDetected / n,
    ciDetected,
    ciDetectedPct: ciDetected / n,
  };
});

/* ---------------- does reading more candidates help? ---------------- */

/**
 * The obvious cheap mitigation is "resolve the top K instead of the top 1".
 * It does not work. After a keyword hijack the correct node is in the top two
 * only a quarter of the time, and an omitted node is unreachable at any K,
 * because it is not in the index at all. Breadth is not a defence against a
 * corrupted index — it just costs more tokens to be wrong.
 */
const topKSurvival = ATTACK_KINDS.map((kind) => {
  const survived = [0, 0, 0];
  let n = 0;
  for (const q of QUESTIONS) {
    const role = q.role ?? "all";
    const clean = docs.get(q.docId)!;
    const target = searchIndex(clean, q.q, role).matches[0]?.entry.id;
    if (!target) continue;
    n++;
    const { doc: pd } = poison(clean, { kind, targetId: target });
    const ids = searchIndex(pd, q.q, role).matches.map((m) => m.entry.id);
    [1, 2, 3].forEach((k, i) => {
      if (ids.slice(0, k).includes(target)) survived[i]++;
    });
  }
  return {
    kind,
    label: ATTACKS[kind].label,
    n,
    k1: survived[0] / n,
    k2: survived[1] / n,
    k3: survived[2] / n,
  };
});

/* ---------------- verification cost ---------------- */

let withDefence = 0;
let withoutDefence = 0;
let fired = 0;
for (const q of QUESTIONS) {
  const role = q.role ?? "all";
  const doc = docs.get(q.docId)!;
  const base = traversalCost(doc, q);
  withoutDefence += base.total;

  const verdict = assessRouting(doc, q.q, role);
  let extra = 0;
  if (verdict.shouldVerify && verdict.sample.length) {
    fired++;
    extra = resolveContext(doc, verdict.sample, role).tokens;
  }
  withDefence += base.total + extra;
}

const report = {
  generatedBy: "scripts/benchmark.ts",
  method: {
    tokenizer: "cl100k_base (gpt-tokenizer) as a proxy for Claude's tokenizer, which is not public",
    model: "none — every figure below is computed deterministically",
    corpus: `${CORPUS.length} documents authored for this project`,
    questions: QUESTIONS.length,
    taskTypes: TASK_TYPES.length,
  },
  tokenEconomics: {
    meanReduction,
    medianReduction,
    bestCase: Math.max(...perQuestion.map((p) => p.reduction)),
    worstCase: Math.min(...perQuestion.map((p) => p.reduction)),
    totalInjectionTokens: perQuestion.reduce((a, b) => a + b.injectionTokens, 0),
    totalTraversalTokens: perQuestion.reduce((a, b) => a + b.traversalTokens, 0),
    byDocClass,
    byTask,
    perQuestion,
    sizeScaling,
    sizeCorrelation,
  },
  audit: {
    cleanFalsePositiveRate: cleanFalsePositives / QUESTIONS.length,
    cleanFalsePositives,
    cleanCiFindings,
    attacks,
    topKSurvival,
    defenceCost: {
      firedOn: fired,
      of: QUESTIONS.length,
      tokensWithout: withoutDefence,
      tokensWith: withDefence,
      overhead: withDefence / withoutDefence - 1,
    },
  },
  answerAccuracy: {
    status: "not-run",
    reason:
      "End-to-end answer accuracy requires a language model. No ANTHROPIC_API_KEY was available when this report was generated. The harness exists (scripts/accuracy.ts) and will populate this section when run with a key. It is deliberately left empty rather than estimated.",
  },
  limitations: [
    `n = ${QUESTIONS.length} questions over ${CORPUS.length} documents, all authored for this project. This is not the paper's 240-document corpus, which is not public, so these figures are an independent measurement and NOT a reproduction of the paper's 92.0% mean.`,
    "Token counts use cl100k_base, not Claude's tokenizer, which Anthropic does not publish. Both lanes are measured with the identical tokenizer, so the ratio is sound even though absolute counts drift a few percent.",
    "Traversal cost assumes the agent resolves its top two index candidates. A model that explores more pays more; a model that guesses better pays less. The figure is a model-independent floor, not a prediction of live behaviour.",
    "Reduction is computed against single-turn injection. A real agent re-injects the document on every turn, so multi-turn savings would be larger. Single-turn is the conservative comparison.",
    "Answer accuracy is unmeasured. A token reduction that broke correctness would be worthless, and this report cannot yet rule that out.",
    "Attack effectiveness is measured on routing, not on final answers. A changed route usually means a wrong answer, but the link is inferred rather than observed.",
  ],
};

writeFileSync(OUT, JSON.stringify(report, null, 2), "utf8");

console.log(`\nbenchmark -> src/data/benchmark.json`);
console.log(`  questions            ${QUESTIONS.length} over ${CORPUS.length} documents`);
console.log(`  mean reduction       ${(meanReduction * 100).toFixed(1)}%`);
console.log(`  median reduction     ${(medianReduction * 100).toFixed(1)}%`);
console.log(`  range                ${(report.tokenEconomics.worstCase * 100).toFixed(1)}% .. ${(report.tokenEconomics.bestCase * 100).toFixed(1)}%`);
console.log(`  clean FP rate        ${(cleanFalsePositives / QUESTIONS.length * 100).toFixed(1)}%`);
console.log(`  defence overhead     ${(report.audit.defenceCost.overhead * 100).toFixed(1)}%`);
console.log(`\n  reduction vs document size (r = ${sizeCorrelation.toFixed(2)})`);
for (const s of sizeScaling) {
  console.log(
    `    ${s.docId.padEnd(11)} ${String(s.docTokens).padStart(6)} tok  ->  ${(s.meanReduction * 100).toFixed(1)}% reduction`
  );
}
console.log(`\n  attack                 routing   query-detect   ci-detect`);
for (const a of attacks) {
  console.log(
    `  ${a.kind.padEnd(22)} ${(a.routingChangedPct * 100).toFixed(0).padStart(3)}%   ` +
      `${(a.queryDetectedPct * 100).toFixed(0).padStart(9)}%   ${(a.ciDetectedPct * 100).toFixed(0).padStart(7)}%`
  );
}
console.log();
