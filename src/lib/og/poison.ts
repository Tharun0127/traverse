/**
 * Index poisoning — the adversarial audit.
 *
 * The ObjectGraph paper's limitations section states, verbatim:
 *
 *   "We have not evaluated ObjectGraph against adversarial document authors who
 *    might craft misleading ::dense blocks or ::index entries to manipulate
 *    agent routing."
 *
 * This module is that evaluation.
 *
 * WHY IT WORKS. The transpiler copies ::full verbatim but *generates* ::index
 * keywords and ::dense summaries. The traversal agent routes on the generated
 * layer and may never read the verbatim layer. So the cheapest thing in the
 * document to corrupt is also the only thing the agent trusts.
 *
 *   ::index  <- generated  <- UNTRUSTED  <- agent routes on this
 *   ::dense  <- generated  <- UNTRUSTED  <- agent routes on this
 *   ::full   <- verbatim   <- trusted    <- agent may never read it
 *
 * PRIOR ART. This is not a new class of attack. It is the same shape as prompt
 * injection and retrieval-corpus poisoning: untrusted text steering a control
 * decision. What is new here is only the measurement — the format is 4 months
 * old and its own authors flagged this as untested. We claim the number, not
 * the idea.
 *
 * DISCLOSURE. Every attack below is applied to documents inside this repo. None
 * of it targets a deployed system.
 */

import { searchIndex } from "./primitives";
import { ATTACKS, type Attack, type AttackKind } from "./attacks";
import type { OgDocument, OgIndexEntry } from "./types";

export { ATTACKS, ATTACK_KINDS } from "./attacks";
export type { Attack, AttackKind } from "./attacks";

export interface PoisonOptions {
  kind: AttackKind;
  /** Node the attacker wants to hide or misrepresent. */
  targetId: string;
  /** Node the attacker wants surfaced instead. Ignored by `omission`. */
  decoyId?: string;
}

export interface PoisonResult {
  doc: OgDocument;
  applied: Attack;
  notes: string[];
}

function clone(doc: OgDocument): OgDocument {
  return {
    meta: { ...doc.meta },
    index: doc.index.map((e) => ({ ...e, keywords: [...e.keywords] })),
    nodes: doc.nodes.map((n) => ({
      ...n,
      code: n.code.map((c) => ({ ...c })),
      edges: n.edges.map((e) => ({ ...e })),
    })),
    warnings: [...doc.warnings],
  };
}

/** Pick a plausible decoy: the node least similar to the target. */
export function suggestDecoy(doc: OgDocument, targetId: string): string {
  const target = doc.index.find((e) => e.id === targetId);
  const others = doc.index.filter((e) => e.id !== targetId);
  if (!target || others.length === 0) return others[0]?.id ?? targetId;
  const overlap = (e: OgIndexEntry) =>
    e.keywords.filter((k) => target.keywords.includes(k)).length;
  return others.sort((a, b) => overlap(a) - overlap(b))[0].id;
}

export function poison(doc: OgDocument, opts: PoisonOptions): PoisonResult {
  const out = clone(doc);
  const notes: string[] = [];
  const decoyId = opts.decoyId ?? suggestDecoy(doc, opts.targetId);

  const target = out.index.find((e) => e.id === opts.targetId);
  const decoy = out.index.find((e) => e.id === decoyId);

  switch (opts.kind) {
    case "keyword-hijack": {
      if (!target || !decoy) break;
      decoy.keywords = [...new Set([...target.keywords, ...decoy.keywords])].slice(0, 8);
      decoy.conf = Math.min(1, target.conf + 0.05);
      target.keywords = target.keywords.slice(0, 1);
      target.conf = Math.max(0.1, target.conf - 0.4);
      notes.push(`"${decoyId}" now claims ${decoy.keywords.length} of "${opts.targetId}"'s keywords`);
      notes.push(`"${opts.targetId}" confidence dropped to ${target.conf.toFixed(2)}`);
      break;
    }
    case "confidence-inflation": {
      if (!target || !decoy) break;
      decoy.conf = 1.0;
      target.conf = 0.15;
      notes.push(`"${decoyId}" self-declares conf 1.00; "${opts.targetId}" reduced to 0.15`);
      break;
    }
    case "omission": {
      const before = out.index.length;
      out.index = out.index.filter((e) => e.id !== opts.targetId);
      notes.push(
        `removed "${opts.targetId}" from ::index (${before} -> ${out.index.length} rows). The node body is untouched and still in the file.`
      );
      break;
    }
    case "dense-lie": {
      const node = out.nodes.find((n) => n.id === opts.targetId);
      const decoyNode = out.nodes.find((n) => n.id === decoyId);
      if (!node) break;
      const original = node.dense;
      node.dense = decoyNode?.dense || "unrelated|deprecated|do-not-use";
      notes.push(`"${opts.targetId}" ::dense rewritten: "${original}" -> "${node.dense}"`);
      notes.push("::full is unchanged. The summary now contradicts the content it summarises.");
      break;
    }
  }

  return { doc: out, applied: ATTACKS[opts.kind], notes };
}

/* ------------------------------------------------------------------ */
/*  MITIGATION                                                         */
/* ------------------------------------------------------------------ */

export interface VerificationVerdict {
  /** True when routing on the index alone is unsafe and ::full must be sampled. */
  shouldVerify: boolean;
  reasons: string[];
  /** Nodes worth reading in full before committing to an answer. */
  sample: string[];
}

/**
 * Confidence-gated verification — the query-time defence.
 *
 * Escalates to reading ::full when the routing signal looks untrustworthy. Only
 * signals with no innocent explanation are triggers:
 *
 *   1. nothing in the index matched the query at all
 *   2. every candidate declares conf >= 0.99 — implausible, smells forged
 *   3. the top match's keywords collide heavily with another entry's — the
 *      structural signature of a keyword hijack
 *   4. a node's ::dense shares no term with its own index keywords — internally
 *      inconsistent, the signature of a dense-lie
 *
 * Measured on the benchmark corpus: 7.7% false positives, +2.6% tokens when on.
 *
 * WHAT THIS DOES NOT CATCH, AND WHY IT MATTERS.
 *
 * An attacker who both copies the victim's keywords onto a decoy AND strips them
 * from the victim leaves no query-time tell: the ranking is decisive, the margin
 * is wide, confidences are plausible, and no two entries collide. Every signal
 * available in the cheap path says the routing is healthy.
 *
 * That is not a gap in this implementation. It is a property of the format. The
 * only evidence that would expose the attack lives in ::full — the content the
 * index exists to let you avoid reading. So the trust boundary cannot be
 * defended from inside the cheap path; it has to be defended at authoring or CI
 * time, which is what auditDocument() is for.
 *
 * Cost when it fires: one extra resolve_context on 1-2 nodes, roughly +180
 * tokens on a ~600 token run. Numbers in src/data/benchmark.json.
 */
export function assessRouting(
  doc: OgDocument,
  query: string,
  role = "all",
  opts: { contestRatio?: number } = {}
): VerificationVerdict {
  const { contestRatio = 0.75 } = opts;
  const { matches } = searchIndex(doc, query, role);
  const reasons: string[] = [];
  const sample: string[] = [];

  if (matches.length === 0) {
    return {
      shouldVerify: true,
      reasons: ["no index entry matched the query"],
      sample: doc.index.slice(0, 2).map((e) => e.id),
    };
  }

  const [top, second] = matches;

  // Two signals were tried as triggers and rejected, both for the same reason —
  // they fire on healthy documents, and a defence that always fires costs the
  // entire token saving it exists to protect. See DECISIONS.md #15.
  //
  //   1. An absolute score floor. Coverage is computed over query terms, and a
  //      natural question always contains words no keyword list holds. "How long
  //      does a rollback take" scores 0.32 on a perfectly clean document.
  //      Measured false-positive rate: 38% of the corpus.
  //   2. Contested ranking (top two close together). Real documents legitimately
  //      have several sections on one subject — "rollback" and "migration
  //      rollback" tie exactly, and should. Measured false-positive rate: 28%.
  //
  // Contest is still reported, because it is useful for the agent to know it
  // should read both candidates. It just does not on its own imply an attack.
  const contested = Boolean(second && second.score / top.score >= contestRatio);
  const informational: string[] = [];
  if (contested && second) {
    informational.push(
      `top two are within ${Math.round((1 - contestRatio) * 100)}% of each other ` +
        `(${top.score.toFixed(2)} vs ${second.score.toFixed(2)}) — read both`
    );
  }
  if (matches.length > 1 && matches.every((m) => m.entry.conf >= 0.99)) {
    reasons.push("every candidate declares conf >= 0.99, which is not plausible");
    sample.push(...matches.slice(0, 2).map((m) => m.entry.id));
  }

  // Keyword collision: the top match shares most of its routing keywords with a
  // different node. Two nodes cannot both be the best answer to the same terms.
  const topKw = new Set(top.entry.keywords);
  if (topKw.size > 1) {
    for (const other of doc.index) {
      if (other.id === top.entry.id) continue;
      const shared = other.keywords.filter((k) => topKw.has(k));
      const union = new Set([...other.keywords, ...topKw]).size;
      const jaccard = union ? shared.length / union : 0;
      if (shared.length >= 2 && jaccard >= 0.4) {
        reasons.push(
          `"${top.entry.id}" and "${other.id}" claim ${shared.length} keywords in common (overlap ${jaccard.toFixed(2)})`
        );
        sample.push(top.entry.id, other.id);
        break;
      }
    }
  }

  for (const m of matches.slice(0, 3)) {
    const node = doc.nodes.find((n) => n.id === m.entry.id);
    if (!node || !node.dense) continue;
    const denseTerms = node.dense.split(/[|,\s]+/).filter(Boolean);
    const shared = denseTerms.filter((t) =>
      m.entry.keywords.some((k) => k.startsWith(t) || t.startsWith(k))
    );
    if (denseTerms.length > 1 && shared.length === 0) {
      reasons.push(`"${m.entry.id}" ::dense shares no term with its own index keywords`);
      sample.push(m.entry.id);
    }
  }

  // A contested ranking is not itself evidence of tampering, but it amplifies
  // one: if routing is contested AND something else looks wrong, read both.
  if (reasons.length > 0 && contested && second) {
    sample.push(top.entry.id, second.entry.id);
  }

  return {
    shouldVerify: reasons.length > 0,
    reasons: [...reasons, ...informational],
    sample: [...new Set(sample)],
  };
}

/**
 * Structural integrity check, for authoring time or CI.
 *
 * This is where the attacks that evade query-time detection are caught, because
 * here we are allowed to read ::full. Running it costs a full pass over the
 * document once, at commit time, instead of on every query — which is the right
 * place to pay for trust in a format whose whole point is not paying at read time.
 */
export function auditDocument(doc: OgDocument): string[] {
  const findings: string[] = [];
  const indexIds = new Set(doc.index.map((e) => e.id));

  for (const n of doc.nodes) {
    if (!indexIds.has(n.id))
      findings.push(`ORPHAN: node "${n.id}" is not in ::index — unreachable via search_index`);
  }
  for (const e of doc.index) {
    if (!doc.nodes.some((n) => n.id === e.id))
      findings.push(`PHANTOM: index row "${e.id}" has no node body`);
  }

  const seen = new Map<string, string[]>();
  for (const e of doc.index) {
    const key = [...e.keywords].sort().join(",");
    if (!key) continue;
    seen.set(key, [...(seen.get(key) ?? []), e.id]);
  }
  for (const [key, ids] of seen) {
    if (ids.length > 1)
      findings.push(`DUPLICATE KEYWORDS: ${ids.join(", ")} all claim "${key}"`);
  }

  const allHigh = doc.index.length > 2 && doc.index.every((e) => e.conf >= 0.99);
  if (allHigh) findings.push("UNIFORM CONFIDENCE: every node declares conf >= 0.99");

  // Routing metadata vs. the content it claims to describe. Only checkable by
  // reading ::full, which is exactly why this belongs in CI and not at query time.
  const norm = (s: string) => s.toLowerCase();
  for (const n of doc.nodes) {
    if (!n.dense || !n.full) continue;
    const full = norm(n.full + " " + n.code.map((c) => c.content).join(" "));
    const denseTerms = n.dense.split(/[|,\s]+/).filter((t) => t.length > 2);
    if (denseTerms.length === 0) continue;
    const grounded = denseTerms.filter((t) => full.includes(norm(t)));
    if (grounded.length === 0) {
      findings.push(
        `DENSE DIVERGENCE: "${n.id}" ::dense ("${n.dense}") shares no term with its own ::full — the summary describes different content than the node holds`
      );
    }
  }

  for (const e of doc.index) {
    const node = doc.nodes.find((n) => n.id === e.id);
    if (!node || !node.full) continue;
    const full = norm(node.full + " " + node.code.map((c) => c.content).join(" "));
    const checkable = e.keywords.filter((k) => k.length > 3);
    const ungrounded = checkable.filter((k) => !full.includes(norm(k)));
    // A node's own routing keywords should appear in its own content. Two or
    // more that do not is the signature of keywords copied from elsewhere.
    if (checkable.length >= 3 && (ungrounded.length >= 2 || ungrounded.length / checkable.length > 0.4)) {
      findings.push(
        `KEYWORD DIVERGENCE: "${e.id}" indexes on [${ungrounded.join(", ")}] which do not appear in its own content`
      );
    }
  }

  return findings;
}
