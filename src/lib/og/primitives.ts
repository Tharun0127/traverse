/**
 * The two-primitive query protocol.
 *
 *   search_index(f, q, r)  -> formatted index string of node IDs whose keywords
 *                             overlap q and whose scope includes r
 *   resolve_context(f, N)  -> full content of nodes N plus everything reachable
 *                             via :requires within a depth limit
 *
 * These are the entire agent-facing API surface of the format. Everything the
 * traversal agent can do, it does through these two calls.
 */

import { countTokens } from "./tokens";
import {
  AUTO_FOLLOW_EDGE,
  scopeVisibleTo,
  type OgDocument,
  type OgIndexEntry,
  type ResolvedContext,
} from "./types";

export const DEFAULT_DEPTH_LIMIT = 2;

/**
 * Words carrying no routing signal. Without this filter, coverage is computed
 * over the noise in a natural question ("how long does a rollback take" is 60%
 * function words) and every real query scores low. That mattered: the first
 * version of the verification gate fired on clean documents because scores were
 * diluted, and a defence that always fires costs the whole token saving it is
 * meant to protect. See DECISIONS.md #15.
 */
const QUERY_STOPWORDS = new Set(
  ("the a an and or but if then else for while with without to from into of on in at by as is are was were be been " +
    "this that these those it its you your we our they their what how why when where which who does do did done " +
    "can will would should could have has having i me my am get got need want please tell show explain")
    .split(/\s+/)
);

/** Tokenize a natural-language query into comparable terms. */
function queryTerms(q: string): string[] {
  const raw = q
    .toLowerCase()
    .split(/[^a-z0-9_-]+/)
    .filter((t) => t.length > 2);
  const content = raw.filter((t) => !QUERY_STOPWORDS.has(t));
  // If the question is nothing but function words, fall back to the raw terms
  // rather than matching nothing at all.
  return content.length > 0 ? content : raw;
}

/** Does a keyword match a query term, allowing a prefix on either side? */
function kwMatches(kw: string, term: string): boolean {
  return kw === term || kw.startsWith(term) || term.startsWith(kw);
}

/**
 * Inverse document frequency over the index.
 *
 * A keyword held by one node identifies it; a keyword held by half the nodes
 * ("minutes", "seconds") identifies nothing. Without this weighting, scores tie
 * constantly — two nodes each matching one of three query terms at the same
 * confidence produce identical scores, and any gate built on separation between
 * candidates then fires on every query. That is not hypothetical: it is what the
 * first version did, on 38% of a clean corpus. See DECISIONS.md #15.
 */
export function buildIdf(index: OgIndexEntry[]): Map<string, number> {
  const n = Math.max(1, index.length);
  const df = new Map<string, number>();
  for (const e of index) {
    for (const kw of new Set(e.keywords)) df.set(kw, (df.get(kw) ?? 0) + 1);
  }
  const idf = new Map<string, number>();
  for (const [kw, count] of df) idf.set(kw, Math.log((n + 1) / (count + 0.5)));
  return idf;
}

/**
 * Overlap score between a query and an index entry.
 *
 * DECISION #2: the paper says "keywords overlap q" without defining overlap.
 * This is IDF-weighted term matching with a prefix fallback (so "deploying"
 * matches "deploy"), scaled by the author-declared `conf`. Deliberately NOT
 * embeddings — the thesis is that declared structure beats learned similarity,
 * and the paper benchmarks against RAG as a baseline it beats. Adding vectors
 * here would quietly reintroduce the thing being argued against.
 */
export function scoreEntry(
  entry: OgIndexEntry,
  terms: string[],
  idf?: Map<string, number>
): number {
  if (terms.length === 0) return 0;

  let matchedWeight = 0;
  let hits = 0;
  for (const term of terms) {
    let best = 0;
    for (const kw of entry.keywords) {
      if (!kwMatches(kw, term)) continue;
      const w = idf?.get(kw) ?? 1;
      if (w > best) best = w;
    }
    if (best > 0) {
      matchedWeight += best;
      hits++;
    }
  }
  if (hits === 0) return 0;

  // Normalise against the best this entry could have scored on these terms, so
  // the number stays in a comparable 0..1 range regardless of index size.
  const maxWeight = idf ? Math.max(...idf.values(), 1) : 1;
  const normalised = matchedWeight / (terms.length * maxWeight);
  const coverageBonus = hits / terms.length;

  return (0.65 * normalised + 0.35 * coverageBonus) * (0.5 + 0.5 * entry.conf);
}

export interface SearchIndexResult {
  /** The exact string handed to the model. */
  text: string;
  matches: Array<{ entry: OgIndexEntry; score: number }>;
  /** Entries hidden from this role. Never revealed to the agent. */
  hiddenByRole: number;
  tokens: number;
}

/**
 * PASS 1 + PASS 2 of the Progressive Disclosure Model.
 *
 * Returns the index rows (cheap, ~30 tokens for the header plus a line each)
 * along with the ::dense summary of each match (~10-15 tokens per node). This
 * is what the agent routes on — and, critically, it is LLM-generated content
 * that the agent has no way to verify. That is the trust boundary the
 * adversarial audit targets. See src/lib/og/poison.ts.
 */
export function searchIndex(
  doc: OgDocument,
  query: string,
  role = "all",
  opts: { limit?: number; includeDense?: boolean } = {}
): SearchIndexResult {
  const { limit = 8, includeDense = true } = opts;
  const terms = queryTerms(query);

  const visible = doc.index.filter((e) => scopeVisibleTo(e.scope, role));
  const hiddenByRole = doc.index.length - visible.length;
  const idf = buildIdf(visible);

  const scored = visible
    .map((entry) => ({ entry, score: scoreEntry(entry, terms, idf) }))
    .filter((m) => m.score > 0)
    .sort((a, b) => b.score - a.score || a.entry.id.localeCompare(b.entry.id))
    .slice(0, limit);

  const denseFor = (id: string) => doc.nodes.find((n) => n.id === id)?.dense ?? "";

  const lines: string[] = [];
  lines.push(`# ${doc.meta.title ?? "untitled"} — index (${visible.length} nodes visible)`);
  if (scored.length === 0) {
    lines.push("# no index entry matched. Broaden the query or list all nodes.");
    // Fall back to listing ids only, so the agent is never dead-ended.
    lines.push(...visible.slice(0, limit).map((e) => `${e.id} | ${e.type} | conf=${e.conf.toFixed(2)}`));
  } else {
    for (const { entry, score } of scored) {
      const base = `${entry.id} | ${entry.type} | conf=${entry.conf.toFixed(2)} | match=${score.toFixed(2)}`;
      lines.push(includeDense ? `${base} | ${denseFor(entry.id)}` : base);
    }
  }

  const text = lines.join("\n");
  return { text, matches: scored, hiddenByRole, tokens: countTokens(text) };
}

/**
 * PASS 3 of the Progressive Disclosure Model.
 *
 * Returns full content for the requested nodes, plus everything reachable from
 * them along :requires edges, bounded by depthLimit. Role filtering applies to
 * followed nodes too — a dependency you are not allowed to see is not silently
 * included. Cycles are safe: `seen` is checked before enqueueing.
 */
export function resolveContext(
  doc: OgDocument,
  nodeIds: string[],
  role = "all",
  depthLimit = DEFAULT_DEPTH_LIMIT
): ResolvedContext {
  const byId = new Map(doc.nodes.map((n) => [n.id, n]));
  const seen = new Set<string>();
  const requested: string[] = [];
  const followed: string[] = [];
  const denied: string[] = [];
  const chunks: string[] = [];

  const queue: Array<{ id: string; depth: number; direct: boolean }> = nodeIds.map(
    (id) => ({ id: id.trim(), depth: 0, direct: true })
  );

  while (queue.length) {
    const { id, depth, direct } = queue.shift()!;
    if (!id || seen.has(id)) continue;

    const node = byId.get(id);
    if (!node) {
      if (direct) denied.push(id);
      continue;
    }
    if (!scopeVisibleTo(node.scope, role)) {
      // Indistinguishable from "does not exist", by design.
      if (direct) denied.push(id);
      continue;
    }

    seen.add(id);
    if (direct) requested.push(id);
    else followed.push(id);

    const parts: string[] = [`## ${node.id} [${node.type}]`];
    if (node.full) parts.push(node.full);
    for (const c of node.code) parts.push("```" + c.lang + "\n" + c.content + "\n```");
    if (node.assertion) {
      const a = node.assertion;
      const rows = [
        a.trigger && `trigger: ${a.trigger}`,
        a.check && `check: ${a.check}`,
        a.onPass && `on-pass: ${a.onPass}`,
        a.onFail && `on-fail: ${a.onFail}`,
        a.timeout && `timeout: ${a.timeout}`,
      ].filter(Boolean);
      if (rows.length) parts.push("assertion:\n" + rows.join("\n"));
    }
    const rel = node.edges.filter((e) => e.type !== AUTO_FOLLOW_EDGE);
    if (rel.length) {
      parts.push("related: " + rel.map((e) => `${e.target} (${e.type})`).join(", "));
    }
    chunks.push(parts.join("\n"));

    if (depth < depthLimit) {
      for (const e of node.edges) {
        if (e.type === AUTO_FOLLOW_EDGE && !seen.has(e.target)) {
          queue.push({ id: e.target, depth: depth + 1, direct: false });
        }
      }
    }
  }

  const text = chunks.join("\n\n---\n\n");
  return { text, requested, followed, denied, tokens: countTokens(text) };
}

/** Every node id visible to a role. Used by the UI, not exposed to the agent. */
export function visibleNodeIds(doc: OgDocument, role: string): string[] {
  return doc.nodes.filter((n) => scopeVisibleTo(n.scope, role)).map((n) => n.id);
}
