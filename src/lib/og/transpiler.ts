/**
 * Markdown -> ObjectGraph transpiler.
 *
 * The paper describes a "three-stage hybrid pipeline where LLMs generate only
 * navigational metadata (::dense blocks and ::index keywords), while all content
 * is copied verbatim by deterministic parsers." That split is reproduced exactly,
 * and it matters for more than fidelity: it is precisely why the adversarial
 * audit works. Stage 2 is the only stage that invents text, and Stage 2's output
 * is the only thing the traversal agent routes on.
 *
 *   Stage 1  structure   deterministic   headings -> nodes, content verbatim
 *   Stage 2  metadata    generative      ::dense + ::index keywords
 *   Stage 3  edges       deterministic   :contains, :precedes, :see-also
 *
 * Stage 2 accepts an injectable generator so the whole pipeline runs offline
 * with a deterministic fallback. See DECISIONS.md #9.
 */

import type { NodeType, OgDocument, OgEdge, OgIndexEntry, OgNode } from "./types";

export interface RawSection {
  id: string;
  title: string;
  level: number;
  body: string;
  code: Array<{ lang: string; content: string }>;
  parentId?: string;
  links: string[];
}

/** Words too common to be useful routing keywords. */
const STOPWORDS = new Set(
  ("the a an and or but if then else for while with without to from into of on in at by as is are was were be been " +
    "this that these those it its you your we our they their he she his her not no yes can will would should could " +
    "do does did done have has had having when where which who whom what how why all any some each other than " +
    "there here more most much many very just only also both few own same so too s t don now")
    .split(/\s+/)
);

function slugify(s: string, taken: Set<string>): string {
  const base =
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "section";
  let id = base;
  let n = 2;
  while (taken.has(id)) id = `${base}-${n++}`;
  taken.add(id);
  return id;
}

/**
 * STAGE 1 — deterministic structural parse.
 * Headings become nodes. Content between headings is copied byte-for-byte.
 */
export function extractSections(markdown: string): RawSection[] {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const sections: RawSection[] = [];
  const taken = new Set<string>();
  const stack: Array<{ id: string; level: number }> = [];

  let current: RawSection | null = null;
  let buffer: string[] = [];
  let inFence = false;
  let fenceLang = "";
  let fenceBuf: string[] = [];

  const flush = () => {
    if (!current) return;
    current.body = buffer.join("\n").replace(/^\n+|\n+$/g, "");
    current.links = [...current.body.matchAll(/\[([^\]]+)\]\(#([^)]+)\)/g)].map((m) => m[2]);
    sections.push(current);
    buffer = [];
  };

  for (const line of lines) {
    const fence = line.match(/^```(\w*)\s*$/);
    if (fence) {
      if (!inFence) {
        inFence = true;
        fenceLang = fence[1] || "text";
        fenceBuf = [];
      } else {
        inFence = false;
        if (current) current.code.push({ lang: fenceLang, content: fenceBuf.join("\n") });
        // Keep a placeholder so ::full still reads naturally without duplicating code.
        buffer.push(`[code: ${fenceLang}]`);
      }
      continue;
    }
    if (inFence) {
      fenceBuf.push(line);
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+?)\s*$/);
    if (heading) {
      flush();
      const level = heading[1].length;
      const title = heading[2].trim();
      const id = slugify(title, taken);
      while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
      const parentId = stack.length ? stack[stack.length - 1].id : undefined;
      stack.push({ id, level });
      current = { id, title, level, body: "", code: [], parentId, links: [] };
      continue;
    }

    if (current) buffer.push(line);
    else if (line.trim()) {
      // Preamble before the first heading becomes an implicit intro node.
      current = {
        id: slugify("intro", taken),
        title: "Introduction",
        level: 1,
        body: "",
        code: [],
        links: [],
      };
      stack.push({ id: current.id, level: 1 });
      buffer.push(line);
    }
  }
  flush();
  return sections;
}

/** Infer a node type from the shape of the content. Heuristic, deterministic. */
export function inferNodeType(section: RawSection): NodeType {
  const t = `${section.title}\n${section.body}`.toLowerCase();
  if (/^\s*(warning|caution|danger|never|do not|don't)\b/m.test(t) || /\b(warning|caution)\b/.test(section.title.toLowerCase()))
    return "warning";
  if (/\b(verify|assert|check that|confirm that|must (?:return|equal|match))\b/.test(t)) return "assertion";
  if (/\b(example|for instance|sample|e\.g\.)\b/.test(section.title.toLowerCase())) return "example";
  if (section.code.length > 0 || /^\s*\d+\.\s+/m.test(section.body) || /\b(run|install|deploy|execute|step)\b/.test(section.title.toLowerCase()))
    return "step";
  return "concept";
}

/**
 * STAGE 2 fallback — deterministic keyword extraction.
 * Used when no generator is supplied, so the toolchain runs with zero API calls.
 */
export function deterministicMetadata(section: RawSection): { dense: string; keywords: string[] } {
  const text = `${section.title} ${section.title} ${section.body}`.toLowerCase();
  const freq = new Map<string, number>();
  for (const w of text.split(/[^a-z0-9_-]+/)) {
    if (w.length < 3 || STOPWORDS.has(w)) continue;
    freq.set(w, (freq.get(w) ?? 0) + 1);
  }
  const keywords = [...freq.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 6)
    .map(([w]) => w);
  return { dense: keywords.slice(0, 5).join("|"), keywords };
}

export type MetadataGenerator = (
  sections: RawSection[]
) => Promise<Array<{ id: string; dense: string; keywords: string[] }>>;

export interface TranspileOptions {
  title?: string;
  /** Stage 2 generator. Omit for the deterministic fallback. */
  generator?: MetadataGenerator;
  /** Assign scopes by node id, for the role-scoping demo. */
  scopeFor?: (section: RawSection) => string;
  /** Assign confidence by node id. Defaults to a fixed 0.9. */
  confFor?: (section: RawSection) => number;
}

export async function transpile(
  markdown: string,
  opts: TranspileOptions = {}
): Promise<OgDocument> {
  const sections = extractSections(markdown);

  // STAGE 2 — the only stage that invents text.
  const meta = opts.generator
    ? await opts.generator(sections)
    : sections.map((s) => ({ id: s.id, ...deterministicMetadata(s) }));
  const metaById = new Map(meta.map((m) => [m.id, m]));

  const nodes: OgNode[] = [];
  const index: OgIndexEntry[] = [];

  sections.forEach((section, i) => {
    const m = metaById.get(section.id) ?? deterministicMetadata(section);
    const type = inferNodeType(section);
    const scope = opts.scopeFor?.(section) ?? "all";
    const conf = opts.confFor?.(section) ?? 0.9;

    // STAGE 3 — deterministic edge inference.
    const edges: OgEdge[] = [];
    if (section.parentId) edges.push({ type: "contains", target: section.parentId });
    const prevSibling = [...sections.slice(0, i)].reverse().find((s) => s.parentId === section.parentId);
    if (prevSibling) edges.push({ type: "precedes", target: prevSibling.id });
    for (const link of section.links) {
      if (sections.some((s) => s.id === link) && link !== section.id) {
        edges.push({ type: "see-also", target: link });
      }
    }
    // A step that follows another step under the same parent depends on it.
    if (type === "step" && prevSibling && inferNodeType(prevSibling) === "step") {
      edges.push({ type: "requires", target: prevSibling.id });
    }

    nodes.push({
      id: section.id,
      type,
      scope,
      dense: m.dense,
      // Content copied verbatim. Never generated.
      full: section.title + (section.body ? "\n" + section.body : ""),
      code: section.code,
      edges,
    });

    index.push({ id: section.id, type, scope, conf, keywords: m.keywords });
  });

  return {
    meta: {
      title: opts.title ?? sections[0]?.title ?? "untitled",
      version: "1.0",
      generator: "traverse-transpiler",
      nodes: String(nodes.length),
    },
    index,
    nodes,
    warnings: [],
  };
}

/** Convenience: transpile with no async generator. */
export function transpileSync(markdown: string, opts: Omit<TranspileOptions, "generator"> = {}): OgDocument {
  const sections = extractSections(markdown);
  const nodes: OgNode[] = [];
  const index: OgIndexEntry[] = [];

  sections.forEach((section, i) => {
    const m = deterministicMetadata(section);
    const type = inferNodeType(section);
    const scope = opts.scopeFor?.(section) ?? "all";
    const conf = opts.confFor?.(section) ?? 0.9;
    const edges: OgEdge[] = [];
    if (section.parentId) edges.push({ type: "contains", target: section.parentId });
    const prevSibling = [...sections.slice(0, i)].reverse().find((s) => s.parentId === section.parentId);
    if (prevSibling) edges.push({ type: "precedes", target: prevSibling.id });
    for (const link of section.links) {
      if (sections.some((s) => s.id === link) && link !== section.id)
        edges.push({ type: "see-also", target: link });
    }
    if (type === "step" && prevSibling && inferNodeType(prevSibling) === "step")
      edges.push({ type: "requires", target: prevSibling.id });

    nodes.push({
      id: section.id,
      type,
      scope,
      dense: m.dense,
      full: section.title + (section.body ? "\n" + section.body : ""),
      code: section.code,
      edges,
    });
    index.push({ id: section.id, type, scope, conf, keywords: m.keywords });
  });

  return {
    meta: {
      title: opts.title ?? sections[0]?.title ?? "untitled",
      version: "1.0",
      generator: "traverse-transpiler",
      nodes: String(nodes.length),
    },
    index,
    nodes,
    warnings: [],
  };
}
