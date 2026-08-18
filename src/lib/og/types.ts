/**
 * Type definitions for the ObjectGraph (.og) format.
 *
 * Source: "ObjectGraph: From Document Injection to Knowledge Traversal --
 * A Native File Format for the Agentic Era", Mohit Dubey, Open Gigantic.
 * arXiv:2604.27820
 *
 * Where the paper is underspecified, the interpretation chosen here is recorded
 * in DECISIONS.md with a rationale. Search that file for the matching number.
 */

/** Node types defined by the format. */
export const NODE_TYPES = [
  "concept",
  "step",
  "warning",
  "example",
  "assertion",
  "meta",
] as const;
export type NodeType = (typeof NODE_TYPES)[number];

/** Edge types defined by the format. */
export const EDGE_TYPES = [
  "requires",
  "precedes",
  "contains",
  "contradicts",
  "elaborates",
  "see-also",
  "supersedes",
  "used-in",
] as const;
export type EdgeType = (typeof EDGE_TYPES)[number];

/**
 * Only `requires` is auto-followed by resolve_context. The paper specifies this
 * explicitly: "plus all nodes reachable via :requires edges within a declared
 * depth limit". Every other edge type is navigational metadata the agent may
 * choose to act on, but is never pulled implicitly. See DECISIONS.md #4.
 */
export const AUTO_FOLLOW_EDGE: EdgeType = "requires";

export interface OgEdge {
  type: EdgeType;
  target: string;
  /** Raw attributes from the edge line, e.g. `limit=2`. */
  attrs?: Record<string, string>;
}

export interface OgCodeBlock {
  lang: string;
  content: string;
}

export interface OgAssertion {
  trigger?: string;
  check?: string;
  onPass?: string;
  onFail?: string;
  onFailAfterRetries?: string;
  timeout?: string;
}

export interface OgNode {
  id: string;
  type: NodeType;
  /** Role that may see this node. "all" means unrestricted. */
  scope: string;
  /** Pass 2: compact keyword summary used for routing. LLM-generated. */
  dense: string;
  /** Pass 3: verbatim content. Copied by deterministic parsers, never generated. */
  full: string;
  code: OgCodeBlock[];
  edges: OgEdge[];
  assertion?: OgAssertion;
}

/** One row of the ::index block. */
export interface OgIndexEntry {
  id: string;
  type: NodeType;
  scope: string;
  /** Author-declared confidence in the index entry, 0..1. */
  conf: number;
  keywords: string[];
}

export interface OgDocument {
  meta: Record<string, string>;
  index: OgIndexEntry[];
  nodes: OgNode[];
  /** Non-fatal problems found while parsing. */
  warnings: string[];
}

/** Result of resolve_context — content plus how it was reached. */
export interface ResolvedContext {
  text: string;
  /** Nodes explicitly requested. */
  requested: string[];
  /** Nodes pulled in transitively by :requires. */
  followed: string[];
  /** Nodes requested but invisible to the caller's role, or absent. */
  denied: string[];
  tokens: number;
}

export function isNodeType(v: string): v is NodeType {
  return (NODE_TYPES as readonly string[]).includes(v);
}

export function isEdgeType(v: string): v is EdgeType {
  return (EDGE_TYPES as readonly string[]).includes(v);
}

/**
 * Role visibility. The paper: "An agent with role r never learns of nodes where
 * rho(n) is not in {r, all}".
 */
export function scopeVisibleTo(scope: string, role: string): boolean {
  if (scope === "all") return true;
  // A node may declare several roles, comma separated. The paper shows only
  // single values; the multi-role reading is ours. See DECISIONS.md #5.
  return scope
    .split(",")
    .map((s) => s.trim())
    .includes(role);
}
