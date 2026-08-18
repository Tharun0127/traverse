/**
 * Document loading, shared by the pages, the API route, and the benchmark script.
 * Transpilation is deterministic, so this is memoised rather than recomputed.
 */

import { CORPUS, getDoc, type CorpusDoc } from "@/data/corpus.generated";
import { transpileSync } from "@/lib/og/transpiler";
import { poison, type AttackKind } from "@/lib/og/poison";
import { searchIndex } from "@/lib/og/primitives";
import type { OgDocument } from "@/lib/og/types";

/**
 * Role assignment for the role-scoping demo. Real .og files declare scope per
 * node; here we assign it by heuristic so one corpus can demonstrate the feature.
 */
function scopeForSection(docId: string, title: string): string {
  const t = title.toLowerCase();
  if (docId === "kb") {
    if (t.includes("billing") || t.includes("compensation")) return "manager";
    if (t.includes("credential") || t.includes("secret")) return "ops";
  }
  if (docId === "runbook") {
    if (t.includes("migration") || t.includes("escalation")) return "ops";
  }
  return "all";
}

const cache = new Map<string, OgDocument>();

export function ogFor(docId: string): OgDocument {
  const hit = cache.get(docId);
  if (hit) return hit;
  const src = getDoc(docId);
  if (!src) throw new Error(`unknown document: ${docId}`);
  const doc = transpileSync(src.markdown, {
    title: src.title,
    scopeFor: (s) => scopeForSection(docId, s.title),
  });
  cache.set(docId, doc);
  return doc;
}

/** Best-guess node an attacker would want to suppress for a given question. */
export function targetFor(doc: OgDocument, question: string, role = "all"): string | undefined {
  return searchIndex(doc, question, role).matches[0]?.entry.id;
}

export function poisonedFor(
  docId: string,
  question: string,
  kind: AttackKind,
  role = "all"
): { doc: OgDocument; target?: string; notes: string[] } {
  const clean = ogFor(docId);
  const target = targetFor(clean, question, role);
  if (!target) return { doc: clean, notes: ["no index entry matched; nothing to poison"] };
  const { doc, notes } = poison(clean, { kind, targetId: target });
  return { doc, target, notes };
}

export { CORPUS, getDoc };
export type { CorpusDoc };
