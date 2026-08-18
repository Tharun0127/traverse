/**
 * End-to-end answer accuracy harness.
 *
 * This is the one measurement the rest of the project cannot make without a
 * model. Everything in scripts/benchmark.ts is deterministic; this is not, so it
 * lives in its own script and its results are merged into benchmark.json only
 * when it is actually run.
 *
 *   ANTHROPIC_API_KEY=sk-... npx tsx scripts/accuracy.ts
 *   ANTHROPIC_API_KEY=sk-... npx tsx scripts/accuracy.ts --attack keyword-hijack
 *
 * Why it matters: a token reduction that quietly broke correctness would be
 * worthless. Until this runs, the headline reduction figure is unvalidated on
 * the only axis that ultimately counts.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { CORPUS } from "../src/data/corpus.generated";
import { QUESTIONS, scoreAnswer } from "../src/data/questions";
import { transpileSync } from "../src/lib/og/transpiler";
import { searchIndex } from "../src/lib/og/primitives";
import { poison, type AttackKind } from "../src/lib/og/poison";
import { runInjection, runTraversal } from "../src/lib/agents/runners";
import type { OgDocument } from "../src/lib/og/types";
import type { RunResult } from "../src/lib/agents/types";

const here = dirname(fileURLToPath(import.meta.url));
const REPORT = join(here, "..", "src", "data", "benchmark.json");

if (!process.env.ANTHROPIC_API_KEY) {
  console.error(
    "\nANTHROPIC_API_KEY is not set.\n\n" +
      "This harness is the one part of the project that needs a model. Without a key\n" +
      "it cannot run, and benchmark.json will continue to report answer accuracy as\n" +
      "not-measured rather than estimating it.\n"
  );
  process.exit(1);
}

const attackArg = process.argv.indexOf("--attack");
const attack = (attackArg > -1 ? process.argv[attackArg + 1] : null) as AttackKind | null;
const mitigate = process.argv.includes("--mitigate");
const limitArg = process.argv.indexOf("--limit");
const limit = limitArg > -1 ? Number(process.argv[limitArg + 1]) : QUESTIONS.length;

const docs = new Map<string, OgDocument>();
for (const d of CORPUS) docs.set(d.id, transpileSync(d.markdown, { title: d.title }));

/** Drain an async generator and return its final value. */
async function drain<T, R>(gen: AsyncGenerator<T, R>): Promise<R> {
  let next = await gen.next();
  while (!next.done) next = await gen.next();
  return next.value;
}

interface Row {
  id: string;
  task: string;
  injectionCorrect: boolean;
  traversalCorrect: boolean;
  injectionTokens: number;
  traversalTokens: number;
}

const rows: Row[] = [];
const questions = QUESTIONS.slice(0, limit);

console.log(
  `\naccuracy harness — ${questions.length} questions` +
    (attack ? `, attack=${attack}` : ", clean") +
    (mitigate ? ", defence on" : "") +
    "\n"
);

for (const q of questions) {
  const source = CORPUS.find((c) => c.id === q.docId)!;
  const role = q.role ?? "all";
  let doc = docs.get(q.docId)!;

  if (attack) {
    const target = searchIndex(doc, q.q, role).matches[0]?.entry.id;
    if (target) doc = poison(doc, { kind: attack, targetId: target }).doc;
  }

  let inj: RunResult;
  let trav: RunResult;
  try {
    [inj, trav] = await Promise.all([
      drain(runInjection(source.markdown, q.q)),
      drain(runTraversal(doc, q.q, { role, mitigate })),
    ]);
  } catch (err) {
    console.error(`  ${q.id}  FAILED: ${err instanceof Error ? err.message : String(err)}`);
    continue;
  }

  const row: Row = {
    id: q.id,
    task: q.task,
    injectionCorrect: scoreAnswer(inj.answer, q),
    traversalCorrect: scoreAnswer(trav.answer, q),
    injectionTokens: inj.inputTokens + inj.outputTokens,
    traversalTokens: trav.inputTokens + trav.outputTokens,
  };
  rows.push(row);

  console.log(
    `  ${q.id.padEnd(7)} inj ${row.injectionCorrect ? "✓" : "✗"}  trav ${
      row.traversalCorrect ? "✓" : "✗"
    }   ${String(row.injectionTokens).padStart(6)} -> ${String(row.traversalTokens).padStart(5)} tok`
  );
}

const n = rows.length || 1;
const summary = {
  status: "measured" as const,
  ranAt: new Date().toISOString(),
  condition: { attack: attack ?? "none", mitigate },
  n: rows.length,
  injectionAccuracy: rows.filter((r) => r.injectionCorrect).length / n,
  traversalAccuracy: rows.filter((r) => r.traversalCorrect).length / n,
  /** The number that matters: traversal correct where injection was also correct. */
  agreementWhereInjectionCorrect:
    rows.filter((r) => r.injectionCorrect && r.traversalCorrect).length /
    Math.max(1, rows.filter((r) => r.injectionCorrect).length),
  meanReduction:
    rows.reduce((a, r) => a + (1 - r.traversalTokens / r.injectionTokens), 0) / n,
  rows,
  caveats: [
    "Single run per question. No variance estimate — re-run with a different seed to get one.",
    "Scoring is substring containment against fixed expected terms, not an LLM judge, so it is strict about phrasing and will undercount paraphrased-but-correct answers.",
    "Model output is non-deterministic; these numbers will move between runs.",
  ],
};

console.log(
  `\n  injection accuracy   ${(summary.injectionAccuracy * 100).toFixed(1)}%` +
    `\n  traversal accuracy   ${(summary.traversalAccuracy * 100).toFixed(1)}%` +
    `\n  agreement            ${(summary.agreementWhereInjectionCorrect * 100).toFixed(1)}%` +
    `\n  mean reduction       ${(summary.meanReduction * 100).toFixed(1)}%\n`
);

try {
  const report = JSON.parse(readFileSync(REPORT, "utf8"));
  report.answerAccuracy = summary;
  writeFileSync(REPORT, JSON.stringify(report, null, 2), "utf8");
  console.log(`merged into src/data/benchmark.json\n`);
} catch {
  console.log(`could not merge into benchmark.json — run npm run bench first\n`);
}
